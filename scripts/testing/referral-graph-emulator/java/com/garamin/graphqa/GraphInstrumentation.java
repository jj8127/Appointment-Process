package com.garamin.graphqa;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.Debug;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** SDK-only instrumentation: real input events, no mocked canvas or network access. */
public class GraphInstrumentation extends Instrumentation {
  private final JSONArray evidence = new JSONArray();
  private File output;
  private Bundle args;
  private boolean measuring = false;

  @Override public void onCreate(Bundle arguments) { args = arguments; super.onCreate(arguments); start(); }
  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      output = new File(getTargetContext().getExternalFilesDir(null), "referral-graph-qa");
      if (!output.mkdirs() && !output.isDirectory()) throw new AssertionError("Cannot create evidence directory");
      Intent launch = getTargetContext().getPackageManager().getLaunchIntentForPackage(getTargetContext().getPackageName());
      if (launch == null) throw new AssertionError("QA launcher missing");
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
      startActivitySync(launch);
      waitForText("추천 그래프 · 에뮬레이터 검증", 30000);
      settle();
      Rect canvas = boundsContaining("추천 관계 그래프.");
      check(canvas.width() > 500 && canvas.height() > 600, "Native canvas bounds are measurable");
      int fitZoom = zoom();
      check(fitZoom > 0 && fitZoom < 25, "Large organization fits below 25 percent");
      if ("performance".equals(args.getString("mode"))) {
        measurePerformance(canvas);
        result.putString("result", "PASS: fictional 300-node repeated gesture and remount performance scenario");
      } else if ("observe".equals(args.getString("mode"))) {
        snapshot("01-fit");
        result.putString("result", "Observed offline native graph");
      } else {
        snapshot("01-fit");
        Rect reportedViewer = boundsContaining("하위 299명");
        Rect viewer = viewerPixels(canvas);
        evidence.put(new JSONObject().put("initialViewerAccessibilityBounds", reportedViewer.toShortString())
          .put("initialViewerPixelBounds", viewer.toShortString()).put("canvas", canvas.toShortString()));
        float cx = viewer.centerX(), cy = viewer.centerY();
        float half = Math.min(canvas.width() * .38f, Math.min(cx - canvas.left - 16, canvas.right - cx - 16));
        check(half > 110, "Viewer has room for two-finger gestures");
        // Spread two fingers twice to reach a readable neighborhood from whole-tree fit.
        pinch(cx, cy, 30, half, false);
        int firstZoom = zoom();
        check(firstZoom > fitZoom * 3, "First native pinch expands graph");
        Rect afterPinch = viewerPixels(canvas);
        evidence.put(new JSONObject().put("afterPinchViewerPixelBounds", afterPinch.toShortString())
          .put("focalDriftX", afterPinch.centerX() - viewer.centerX()).put("focalDriftY", afterPinch.centerY() - viewer.centerY()));
        check(Math.abs(afterPinch.centerX() - viewer.centerX()) < 6 && Math.abs(afterPinch.centerY() - viewer.centerY()) < 6,
          "Lifting one finger after a pinch preserves the focal node position");
        snapshot("02-pinch");
        pinch(cx, cy, half / 2, half, false);
        check(zoom() > firstZoom, "Second native pinch expands graph");
        snapshot("03-readable");
        int readableZoom = zoom();
        Rect beforePan = viewerPixels(canvas);
        swipe(cx, cy, cx + 110, cy + 80);
        check(zoom() == readableZoom, "One-finger pan preserves zoom");
        Rect afterPan = viewerPixels(canvas);
        evidence.put(new JSONObject().put("nativePanDx", afterPan.centerX() - beforePan.centerX())
          .put("nativePanDy", afterPan.centerY() - beforePan.centerY()));
        // Pan activation consumes the first ~3dp of motion plus an input step.
        check(Math.abs(afterPan.centerX() - beforePan.centerX() - 110) < 14
          && Math.abs(afterPan.centerY() - beforePan.centerY() - 80) < 14, "Native node follows the pan distance within touch slop");
        snapshot("04-pan");
        // Locate the rendered viewer independently of the layout calculations.
        tap(afterPan.centerX(), afterPan.centerY());
        waitForText("선택: synthetic-000", 5000);
        snapshot("05-selected");
        pinch(cx, cy, 80, 130, true);
        check(zoom() >= readableZoom, "Cancelled pinch finalizes the zoom badge");
        snapshot("06-cancelled-pinch");
        tapText("화면 맞춤");
        check(zoom() == fitZoom, "Fit restores initial scale after pan and pinch");
        Rect fitViewer = viewerPixels(canvas);
        check(Math.abs(fitViewer.centerX() - viewer.centerX()) < 3 && Math.abs(fitViewer.centerY() - viewer.centerY()) < 3,
          "Fit restores the original native node position");
        snapshot("07-fit-restored");
        pinch(cx, cy, 30, half, false);
        pinch(cx, cy, half, 20, false);
        check(zoom() >= fitZoom, "Pinch-in respects the fit lower bound");
        tapText("초기화");
        check(zoom() == fitZoom && hasText("선택 없음"), "Reset restores overview and clears selection");
        snapshot("08-reset");
        pinch(cx, cy, 30, half, false);
        Rect fitControl = boundsContaining("화면 맞춤");
        long fitReleased = tapWithoutSettling(fitControl.centerX(), fitControl.centerY());
        evidence.put(new JSONObject().put("fitInterruptionPanRequestedAfterMs", SystemClock.uptimeMillis() - fitReleased)
          .put("note", "Input requested before settling; native gesture-handler start time is not sampled"));
        swipe(cx, cy, cx + 70, cy + 40);
        snapshot("09-fit-pan-interruption");
        tapText("초기화");
        result.putString("result", "PASS: native fit, pinch-out/in, pan, selection, cancellation, reset and fit-pan label recovery");
      }
      result.putString("evidence", output.getAbsolutePath());
      writeReport();
      finish(-1, result);
    } catch (Throwable error) {
      try { if (output != null) writeReport(); } catch (Exception ignored) { }
      result.putString("failure", error.getClass().getSimpleName() + ": " + error.getMessage());
      finish(1, result);
    }
  }

  private void measurePerformance(Rect canvas) throws Exception {
    measuring = true;
    check(hasText("가상 조직도"), "Performance fixture is entirely fictional");
    float cx = canvas.centerX(), cy = canvas.centerY();
    float half = Math.min(canvas.width() * .32f, 200);
    pinch(cx, cy, 30, half, false);
    pinch(cx, cy, half / 2, half, false);
    swipe(cx, cy, cx + 80, cy + 60);
    swipe(cx + 80, cy + 60, cx, cy);
    recordMemory("warmed");
    shellAggregate("dumpsys gfxinfo " + getTargetContext().getPackageName() + " reset");
    long started = SystemClock.uptimeMillis();
    for (int round = 0; round < 2; round++) {
      swipe(cx, cy, cx + 110, cy + 70);
      swipe(cx + 110, cy + 70, cx, cy);
      pinch(cx, cy, half / 2, half, false);
      pinch(cx, cy, half, half / 2, false);
      recordMemory("gesture-round-" + (round + 1));
    }
    JSONObject frames = new JSONObject().put("phase", "gesture-frames")
      .put("elapsedMs", SystemClock.uptimeMillis() - started).put("rounds", 2)
      .put("inputStepsPerGesture", 8).put("panGestures", 4).put("pinchGestures", 4);
    String aggregate = shellAggregate("dumpsys gfxinfo " + getTargetContext().getPackageName());
    for (String line : aggregate.split("\\r?\\n")) {
      String value = line.trim();
      if (value.matches("Total frames rendered: [0-9]+")) frames.put("totalFrames", Integer.parseInt(value.replaceAll("[^0-9]", "")));
      else if (value.matches("Janky frames: [0-9]+ \\([0-9.]+%\\)")) {
        frames.put("jankyFrames", Integer.parseInt(value.split(" ")[2]));
        frames.put("jankyPercent", Double.parseDouble(value.substring(value.indexOf('(') + 1, value.indexOf('%'))));
      } else if (value.matches("(50th|90th|95th|99th) percentile: [0-9]+ms")) {
        frames.put(value.substring(0, value.indexOf(' ')) + "PercentileMs", Integer.parseInt(value.substring(value.indexOf(':') + 1).replaceAll("[^0-9]", "")));
      }
    }
    // Never persist raw dumpsys output, hierarchy nodes, logcat, or runtime contents.
    frames.put("available", frames.has("totalFrames"));
    evidence.put(frames);
    for (int index = 0; index < 3; index++) {
      tapText("다시 열기");
      check(hasText("가상 조직도") && zoom() > 0, "Fictional graph remains usable after remount " + (index + 1));
      recordMemory("remount-" + (index + 1));
    }
    SystemClock.sleep(2000);
    recordMemory("settled-after-remounts");
  }
  private void recordMemory(String phase) throws Exception {
    Debug.MemoryInfo memory = new Debug.MemoryInfo();
    Debug.getMemoryInfo(memory);
    evidence.put(new JSONObject().put("phase", phase).put("totalPssKb", memory.getTotalPss())
      .put("dalvikPssKb", memory.dalvikPss).put("nativePssKb", memory.nativePss).put("otherPssKb", memory.otherPss));
    writeReport();
  }
  private String shellAggregate(String command) throws Exception {
    try (ParcelFileDescriptor descriptor = getUiAutomation().executeShellCommand(command);
         ParcelFileDescriptor.AutoCloseInputStream stream = new ParcelFileDescriptor.AutoCloseInputStream(descriptor);
         ByteArrayOutputStream data = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[4096];
      int count;
      while ((count = stream.read(buffer)) != -1) data.write(buffer, 0, count);
      return new String(data.toByteArray(), StandardCharsets.UTF_8);
    }
  }

  private void check(boolean condition, String message) throws Exception {
    evidence.put(new JSONObject().put("check", message).put("passed", condition));
    if (!condition) throw new AssertionError(message);
  }
  private void writeReport() throws Exception {
    try (FileOutputStream stream = new FileOutputStream(new File(output, "report.json"))) {
      stream.write(evidence.toString(2).getBytes(StandardCharsets.UTF_8));
    }
  }
  private void settle() { SystemClock.sleep(700); try { getUiAutomation().waitForIdle(250, 2000); } catch (Exception ignored) { } }
  private List<AccessibilityNodeInfo> nodes() {
    List<AccessibilityNodeInfo> list = new ArrayList<>();
    collect(getUiAutomation().getRootInActiveWindow(), list); return list;
  }
  private void collect(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> list) {
    if (node == null) return; list.add(node);
    for (int i = 0; i < node.getChildCount(); i++) collect(node.getChild(i), list);
  }
  private String text(AccessibilityNodeInfo node) {
    return String.valueOf(node.getText()) + " " + String.valueOf(node.getContentDescription());
  }
  private boolean hasText(String value) { for (AccessibilityNodeInfo n : nodes()) if (text(n).contains(value)) return true; return false; }
  private void waitForText(String value, long timeout) {
    long end = SystemClock.uptimeMillis() + timeout;
    while (SystemClock.uptimeMillis() < end) { if (hasText(value)) return; SystemClock.sleep(300); }
    throw new AssertionError("Expected offline QA screen marker missing: " + value);
  }
  private Rect boundsContaining(String value) {
    for (AccessibilityNodeInfo n : nodes()) if (text(n).contains(value)) { Rect r = new Rect(); n.getBoundsInScreen(r); return r; }
    throw new AssertionError("Control missing: " + value);
  }
  private int zoom() {
    for (AccessibilityNodeInfo n : nodes()) {
      String value = String.valueOf(n.getText());
      if (value.matches("[0-9]+%")) return Integer.parseInt(value.substring(0, value.length() - 1));
    }
    throw new AssertionError("Zoom badge missing");
  }
  private Rect viewerPixels(Rect canvas) {
    Bitmap bitmap = getUiAutomation().takeScreenshot();
    if (bitmap == null) throw new AssertionError("Screenshot missing while locating viewer");
    int width = bitmap.getWidth(), height = bitmap.getHeight();
    int[] pixels = new int[width * height]; bitmap.getPixels(pixels, 0, width, 0, 0, width, height); bitmap.recycle();
    int minX = width, minY = height, maxX = -1, maxY = -1;
    for (int y = Math.max(0, canvas.top); y < Math.min(height, canvas.bottom); y++) {
      for (int x = Math.max(0, canvas.left); x < Math.min(width, canvas.right); x++) {
        int pixel = pixels[y * width + x];
        int red = (pixel >> 16) & 255, green = (pixel >> 8) & 255, blue = pixel & 255;
        if (red > 190 && green > 150 && blue < 110) {
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < minX) throw new AssertionError("Rendered viewer is outside the canvas");
    return new Rect(minX, minY, maxX + 1, maxY + 1);
  }
  private void snapshot(String name) throws Exception {
    check(hasText("가상 조직도"), "Screenshot contains only the offline fictional QA screen");
    Bitmap bitmap = getUiAutomation().takeScreenshot();
    if (bitmap == null) throw new AssertionError("Native screenshot unavailable");
    try (FileOutputStream stream = new FileOutputStream(new File(output, name + ".png"))) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream); }
    Rect canvas = boundsContaining("추천 관계 그래프.");
    int[] imagePixels = new int[bitmap.getWidth() * bitmap.getHeight()];
    bitmap.getPixels(imagePixels, 0, bitmap.getWidth(), 0, 0, bitmap.getWidth(), bitmap.getHeight());
    int edgePixels = 0;
    int labelPixels = 0;
    for (int y = Math.max(0, canvas.top); y < Math.min(bitmap.getHeight(), canvas.bottom); y++) {
      for (int x = Math.max(0, canvas.left); x < Math.min(bitmap.getWidth(), canvas.right); x++) {
        int pixel = imagePixels[y * bitmap.getWidth() + x];
        int red = (pixel >> 16) & 255, green = (pixel >> 8) & 255, blue = pixel & 255;
        if (Math.abs(red - 203) <= 4 && Math.abs(green - 213) <= 4 && Math.abs(blue - 225) <= 4) edgePixels++;
        if (Math.abs(red - 51) <= 4 && Math.abs(green - 65) <= 4 && Math.abs(blue - 85) <= 4) labelPixels++;
      }
    }
    evidence.put(new JSONObject().put("screenshot", name + ".png").put("zoomPercent", zoom()).put("width", bitmap.getWidth()).put("height", bitmap.getHeight())
      .put("nativeEdgeColorPixels", edgePixels).put("nativeLabelColorPixels", labelPixels));
    if ("01-fit".equals(name)) check(edgePixels > 100, "Relationship edge ink is present in the native overview");
    if ("09-fit-pan-interruption".equals(name)) check(labelPixels > 10, "Node labels recover after an immediate fit-pan sequence");
    bitmap.recycle();
  }
  private void tapText(String value) { Rect r = boundsContaining(value); tap(r.centerX(), r.centerY()); }
  private void tap(float x, float y) {
    tapWithoutSettling(x, y); settle();
  }
  private long tapWithoutSettling(float x, float y) {
    long down = SystemClock.uptimeMillis(); send(down, MotionEvent.ACTION_DOWN, new float[]{x}, new float[]{y});
    SystemClock.sleep(60); send(down, MotionEvent.ACTION_UP, new float[]{x}, new float[]{y});
    return SystemClock.uptimeMillis();
  }
  private void swipe(float x, float y, float tx, float ty) {
    long down = SystemClock.uptimeMillis(); send(down, MotionEvent.ACTION_DOWN, new float[]{x}, new float[]{y});
    int steps = measuring ? 8 : 25;
    for (int i = 1; i <= steps; i++) { SystemClock.sleep(16); float p = i / (float)steps; send(down, MotionEvent.ACTION_MOVE, new float[]{x + (tx - x) * p}, new float[]{y + (ty - y) * p}); }
    send(down, MotionEvent.ACTION_UP, new float[]{tx}, new float[]{ty}); settle();
  }
  private void pinch(float x, float y, float from, float to, boolean cancel) {
    long down = SystemClock.uptimeMillis();
    send(down, MotionEvent.ACTION_DOWN, new float[]{x - from}, new float[]{y});
    SystemClock.sleep(40);
    send(down, MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), new float[]{x - from, x + from}, new float[]{y, y});
    int steps = measuring ? 8 : 18;
    for (int i = 1; i <= steps; i++) { SystemClock.sleep(25); float spread = from + (to - from) * i / (float)steps; send(down, MotionEvent.ACTION_MOVE, new float[]{x - spread, x + spread}, new float[]{y, y}); }
    if (cancel) send(down, MotionEvent.ACTION_CANCEL, new float[]{x - to, x + to}, new float[]{y, y});
    else {
      send(down, MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), new float[]{x - to, x + to}, new float[]{y, y});
      send(down, MotionEvent.ACTION_UP, new float[]{x - to}, new float[]{y});
    }
    settle();
  }
  private void send(long down, int action, float[] xs, float[] ys) {
    MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[xs.length];
    MotionEvent.PointerCoords[] coordinates = new MotionEvent.PointerCoords[xs.length];
    for (int i = 0; i < xs.length; i++) {
      properties[i] = new MotionEvent.PointerProperties(); properties[i].id = i; properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
      coordinates[i] = new MotionEvent.PointerCoords(); coordinates[i].x = xs[i]; coordinates[i].y = ys[i]; coordinates[i].pressure = 1; coordinates[i].size = 1;
    }
    MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, xs.length, properties, coordinates, 0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
    boolean injected = getUiAutomation().injectInputEvent(event, true); event.recycle();
    if (!injected) throw new AssertionError("Android rejected input event");
  }
}
