package com.garamin.build;

import com.android.build.api.AndroidPluginVersion;
import com.android.build.api.artifact.ScopedArtifact;
import com.android.build.api.dsl.ApplicationExtension;
import com.android.build.api.instrumentation.AsmClassVisitorFactory;
import com.android.build.api.instrumentation.ClassContext;
import com.android.build.api.instrumentation.ClassData;
import com.android.build.api.instrumentation.FramesComputationMode;
import com.android.build.api.instrumentation.InstrumentationParameters;
import com.android.build.api.instrumentation.InstrumentationScope;
import com.android.build.api.variant.ApplicationAndroidComponentsExtension;
import com.android.build.api.variant.ApplicationVariant;
import com.android.build.api.variant.ScopedArtifacts;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import kotlin.Unit;
import org.gradle.api.Action;
import org.gradle.api.DefaultTask;
import org.gradle.api.GradleException;
import org.gradle.api.Plugin;
import org.gradle.api.Project;
import org.gradle.api.artifacts.ArtifactCollection;
import org.gradle.api.artifacts.component.ModuleComponentIdentifier;
import org.gradle.api.artifacts.type.ArtifactTypeDefinition;
import org.gradle.api.file.ConfigurableFileCollection;
import org.gradle.api.file.Directory;
import org.gradle.api.file.RegularFile;
import org.gradle.api.provider.ListProperty;
import org.gradle.api.provider.Property;
import org.gradle.api.tasks.CacheableTask;
import org.gradle.api.tasks.Classpath;
import org.gradle.api.tasks.Input;
import org.gradle.api.tasks.TaskAction;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.Handle;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

public final class ReactAndroidDrawingOrderGuardPlugin implements Plugin<Project> {
  static final String EXPECTED_AGP_VERSION = "8.11.0";
  static final String EXPECTED_REACT_ANDROID_COMPONENT =
      "com.facebook.react:react-android:0.81.5";
  static final String EXPECTED_RELEASE_AAR_SHA256 =
      "a4da05bc571946aa1034c0d7be46593719105fb9e81d58aded9183c85a1f04fc";
  static final String EXPECTED_RELEASE_TARGET_CLASS_SHA256 =
      "751dfdb935c8e66ab23dc15ac7e072a7d95fba6b7d8fb48d97ece3a2f171b0f5";
  static final String EXPECTED_DEBUG_AAR_SHA256 =
      "5780b154ece55333bf4c606fc9e0fda3f7e925aaa7297e89faf95ca92db9619b";
  static final String EXPECTED_DEBUG_TARGET_CLASS_SHA256 =
      "13e27eeff4a38a7977bf83a415a5d6600859f51c2886b55e41e10cb2c929974e";
  static final String EXPECTED_DEBUG_OPTIMIZED_AAR_SHA256 =
      "56c8f1701ce4f85c92c88fdbc0216a2926db2c079945afdb68ffa995fbde02e4";
  static final String EXPECTED_DEBUG_OPTIMIZED_TARGET_CLASS_SHA256 =
      "8689166a37eb4388245d810543a7d56d468f9ebd13dfba3db0197c4fc2730030";
  static final String TARGET_CLASS_NAME =
      "com.facebook.react.views.swiperefresh.ReactSwipeRefreshLayout";
  static final String TARGET_CLASS_INTERNAL_NAME =
      "com/facebook/react/views/swiperefresh/ReactSwipeRefreshLayout";
  static final String TARGET_CLASS_ENTRY = TARGET_CLASS_INTERNAL_NAME + ".class";
  static final String TARGET_SUPER_INTERNAL_NAME =
      "androidx/swiperefreshlayout/widget/SwipeRefreshLayout";
  static final String METHOD_NAME = "getChildDrawingOrder";
  static final String METHOD_DESCRIPTOR = "(II)I";
  static final List<String> REQUIRED_NATIVE_ENTRIES =
      List.of(
          "jni/arm64-v8a/libreactnative.so",
          "jni/armeabi-v7a/libreactnative.so",
          "jni/x86/libreactnative.so",
          "jni/x86_64/libreactnative.so");

  @Override
  public void apply(Project project) {
    project
        .getPluginManager()
        .withPlugin("com.android.application", ignored -> configureAndroidApplication(project));
  }

  private void configureAndroidApplication(Project project) {
    String actualAgpVersion = AndroidPluginVersion.getCurrent().getVersion();
    if (!EXPECTED_AGP_VERSION.equals(actualAgpVersion)) {
      throw new GradleException(
          "[drawing-order-guard] Expected AGP "
              + EXPECTED_AGP_VERSION
              + ", found "
              + actualAgpVersion
              + ". Review the instrumentation before building.");
    }

    File proguardRules =
        new File(
            project.getRootDir().getParentFile(),
            "gradle-plugins/react-android-drawing-order-guard/drawing-order-guard.pro");
    if (!proguardRules.isFile()) {
      throw new GradleException(
          "[drawing-order-guard] Missing tracked R8 rule: " + proguardRules.getAbsolutePath());
    }
    ApplicationExtension applicationExtension =
        project.getExtensions().getByType(ApplicationExtension.class);
    applicationExtension.getBuildTypes().getByName("release").proguardFile(proguardRules);

    ApplicationAndroidComponentsExtension androidComponents =
        project.getExtensions().getByType(ApplicationAndroidComponentsExtension.class);
    androidComponents.onVariants(
        androidComponents.selector().all(),
        (Action<ApplicationVariant>) variant -> configureVariant(project, variant));
  }

  private void configureVariant(Project project, ApplicationVariant variant) {
    VariantHashContract hashContract = VariantHashContract.forBuildType(variant.getBuildType());
    String capitalizedVariant = capitalize(variant.getName());

    variant
        .getInstrumentation()
        .transformClassesWith(
            ReactSwipeRefreshLayoutVisitorFactory.class,
            InstrumentationScope.ALL,
            parameters -> Unit.INSTANCE);
    variant
        .getInstrumentation()
        .setAsmFramesComputationMode(
            FramesComputationMode.COMPUTE_FRAMES_FOR_INSTRUMENTED_METHODS);

    ArtifactCollection reactAndroidAars =
        variant
            .getRuntimeConfiguration()
            .getIncoming()
            .artifactView(
                view -> {
                  view.componentFilter(
                      componentIdentifier ->
                          componentIdentifier instanceof ModuleComponentIdentifier module
                              && "com.facebook.react".equals(module.getGroup())
                              && "react-android".equals(module.getModule()));
                  view.attributes(
                      attributes ->
                          attributes.attribute(
                              ArtifactTypeDefinition.ARTIFACT_TYPE_ATTRIBUTE, "aar"));
                })
            .getArtifacts();

    var provenanceTask =
        project
            .getTasks()
            .register(
                "verify" + capitalizedVariant + "ReactAndroidDrawingOrderInput",
                VerifyReactAndroidInputTask.class,
                task -> {
                  task.getReactAndroidAars().from(reactAndroidAars.getArtifactFiles());
                  task.getResolvedReactAndroidComponents()
                      .set(
                          project.provider(
                              () ->
                                  variant
                                      .getRuntimeConfiguration()
                                      .getIncoming()
                                      .getResolutionResult()
                                      .getAllComponents()
                                      .stream()
                                      .map(component -> component.getId())
                                      .filter(ModuleComponentIdentifier.class::isInstance)
                                      .map(ModuleComponentIdentifier.class::cast)
                                      .filter(
                                          module ->
                                              "com.facebook.react".equals(module.getGroup())
                                                  && "react-android".equals(module.getModule()))
                                      .map(
                                          module ->
                                              module.getGroup()
                                                  + ":"
                                                  + module.getModule()
                                                  + ":"
                                                  + module.getVersion())
                                      .sorted()
                                      .toList()));
                  task.getExpectedAarSha256().set(hashContract.aarSha256());
                  task.getExpectedTargetClassSha256().set(hashContract.targetClassSha256());
                  task.getVariantName().set(variant.getName());
                });
    variant.getLifecycleTasks().registerPreBuild(provenanceTask);

    var outputTask =
        project
            .getTasks()
            .register(
                "verify" + capitalizedVariant + "ReactAndroidDrawingOrderOutput",
                VerifyInstrumentedClassTask.class,
                task -> {
                  task.dependsOn(provenanceTask);
                  task.getVariantName().set(variant.getName());
                });
    variant
        .getArtifacts()
        .forScope(ScopedArtifacts.Scope.ALL)
        .use(outputTask)
        .toGet(
            ScopedArtifact.CLASSES.INSTANCE,
            VerifyInstrumentedClassTask::getAllJars,
            VerifyInstrumentedClassTask::getAllDirectories);

    Set<String> terminalTaskNames =
        Set.of("assemble" + capitalizedVariant, "bundle" + capitalizedVariant);
    project
        .getTasks()
        .matching(task -> terminalTaskNames.contains(task.getName()))
        .configureEach(task -> task.dependsOn(outputTask));
  }

  private static String capitalize(String value) {
    if (value.isEmpty()) {
      return value;
    }
    return Character.toUpperCase(value.charAt(0)) + value.substring(1);
  }

  record VariantHashContract(String aarSha256, String targetClassSha256) {
    static VariantHashContract forBuildType(String buildType) {
      return switch (buildType) {
        case "release" ->
            new VariantHashContract(
                EXPECTED_RELEASE_AAR_SHA256, EXPECTED_RELEASE_TARGET_CLASS_SHA256);
        case "debug" ->
            new VariantHashContract(EXPECTED_DEBUG_AAR_SHA256, EXPECTED_DEBUG_TARGET_CLASS_SHA256);
        case "debugOptimized" ->
            new VariantHashContract(
                EXPECTED_DEBUG_OPTIMIZED_AAR_SHA256,
                EXPECTED_DEBUG_OPTIMIZED_TARGET_CLASS_SHA256);
        default ->
            throw new GradleException(
                "[drawing-order-guard] Unsupported Android build type "
                    + buildType
                    + "; audit and pin its ReactAndroid AAR before building.");
      };
    }
  }

  public abstract static class ReactSwipeRefreshLayoutVisitorFactory
      implements AsmClassVisitorFactory<InstrumentationParameters.None> {
    @Override
    public boolean isInstrumentable(ClassData classData) {
      return TARGET_CLASS_NAME.equals(classData.getClassName());
    }

    @Override
    public ClassVisitor createClassVisitor(
        ClassContext classContext, ClassVisitor nextClassVisitor) {
      return new InjectGuardClassVisitor(
          getInstrumentationContext().getApiVersion().get(), nextClassVisitor);
    }
  }

  static final class InjectGuardClassVisitor extends ClassVisitor {
    private boolean visitedTarget;
    private boolean existingGuardMethod;

    InjectGuardClassVisitor(int api, ClassVisitor nextClassVisitor) {
      super(api, nextClassVisitor);
    }

    @Override
    public void visit(
        int version,
        int access,
        String name,
        String signature,
        String superName,
        String[] interfaces) {
      visitedTarget = true;
      if (version != Opcodes.V17
          || access != (Opcodes.ACC_PUBLIC | Opcodes.ACC_FINAL | Opcodes.ACC_SUPER)
          || !TARGET_CLASS_INTERNAL_NAME.equals(name)
          || !TARGET_SUPER_INTERNAL_NAME.equals(superName)
          || interfaces.length != 0) {
        throw new GradleException(
            "[drawing-order-guard] ReactSwipeRefreshLayout class shape changed; review the instrumentation before building.");
      }
      super.visit(version, access, name, signature, superName, interfaces);
    }

    @Override
    public MethodVisitor visitMethod(
        int access,
        String name,
        String descriptor,
        String signature,
        String[] exceptions) {
      if (METHOD_NAME.equals(name) && METHOD_DESCRIPTOR.equals(descriptor)) {
        existingGuardMethod = true;
      }
      return super.visitMethod(access, name, descriptor, signature, exceptions);
    }

    @Override
    public void visitEnd() {
      if (!visitedTarget || existingGuardMethod) {
        throw new GradleException(
            "[drawing-order-guard] Target class is missing or already defines getChildDrawingOrder(II)I; review the instrumentation before building.");
      }

      MethodVisitor methodVisitor =
          super.visitMethod(Opcodes.ACC_PUBLIC, METHOD_NAME, METHOD_DESCRIPTOR, null, null);
      Label fallback = new Label();
      methodVisitor.visitCode();
      methodVisitor.visitVarInsn(Opcodes.ALOAD, 0);
      methodVisitor.visitVarInsn(Opcodes.ILOAD, 1);
      methodVisitor.visitVarInsn(Opcodes.ILOAD, 2);
      methodVisitor.visitMethodInsn(
          Opcodes.INVOKESPECIAL,
          TARGET_SUPER_INTERNAL_NAME,
          METHOD_NAME,
          METHOD_DESCRIPTOR,
          false);
      methodVisitor.visitVarInsn(Opcodes.ISTORE, 3);
      methodVisitor.visitVarInsn(Opcodes.ILOAD, 3);
      methodVisitor.visitJumpInsn(Opcodes.IFLT, fallback);
      methodVisitor.visitVarInsn(Opcodes.ILOAD, 3);
      methodVisitor.visitVarInsn(Opcodes.ILOAD, 1);
      methodVisitor.visitJumpInsn(Opcodes.IF_ICMPGE, fallback);
      methodVisitor.visitVarInsn(Opcodes.ILOAD, 3);
      methodVisitor.visitInsn(Opcodes.IRETURN);
      methodVisitor.visitLabel(fallback);
      methodVisitor.visitVarInsn(Opcodes.ILOAD, 2);
      methodVisitor.visitInsn(Opcodes.IRETURN);
      methodVisitor.visitMaxs(0, 0);
      methodVisitor.visitEnd();
      super.visitEnd();
    }
  }

  @CacheableTask
  public abstract static class VerifyReactAndroidInputTask extends DefaultTask {
    @Classpath
    public abstract ConfigurableFileCollection getReactAndroidAars();

    @Input
    public abstract ListProperty<String> getResolvedReactAndroidComponents();

    @Input
    public abstract Property<String> getExpectedAarSha256();

    @Input
    public abstract Property<String> getExpectedTargetClassSha256();

    @Input
    public abstract Property<String> getVariantName();

    @TaskAction
    public void verify() {
      List<String> components = getResolvedReactAndroidComponents().get();
      if (!components.equals(List.of(EXPECTED_REACT_ANDROID_COMPONENT))) {
        throw new GradleException(
            "[drawing-order-guard] Expected exactly one Maven "
                + EXPECTED_REACT_ANDROID_COMPONENT
                + " component, found "
                + components
                + ". ReactAndroid source substitution is not allowed.");
      }

      Set<File> aarFiles = getReactAndroidAars().getFiles();
      if (aarFiles.size() != 1) {
        throw new GradleException(
            "[drawing-order-guard] Expected exactly one raw ReactAndroid AAR, found "
                + aarFiles.size()
                + ".");
      }
      File aarFile = aarFiles.iterator().next();
      String actualAarHash = sha256(aarFile);
      if (!getExpectedAarSha256().get().equals(actualAarHash)) {
        throw new GradleException(
            "[drawing-order-guard] ReactAndroid AAR hash mismatch for "
                + getVariantName().get()
                + ": "
                + actualAarHash);
      }

      byte[] targetClass = readTargetClassFromAar(aarFile);
      String actualTargetHash = sha256(targetClass);
      if (!getExpectedTargetClassSha256().get().equals(actualTargetHash)) {
        throw new GradleException(
            "[drawing-order-guard] ReactSwipeRefreshLayout class hash mismatch for "
                + getVariantName().get()
                + ": "
                + actualTargetHash);
      }
      verifyOriginalClassShape(targetClass);
      getLogger()
          .lifecycle(
              "[drawing-order-guard] Verified official ReactAndroid input for {}.",
              getVariantName().get());
    }
  }

  @CacheableTask
  public abstract static class VerifyInstrumentedClassTask extends DefaultTask {
    @Classpath
    public abstract ListProperty<RegularFile> getAllJars();

    @Classpath
    public abstract ListProperty<Directory> getAllDirectories();

    @Input
    public abstract Property<String> getVariantName();

    @TaskAction
    public void verify() {
      List<byte[]> candidates = new ArrayList<>();
      List<String> locations = new ArrayList<>();

      for (RegularFile regularFile : getAllJars().get()) {
        File jarFile = regularFile.getAsFile();
        try (ZipFile zipFile = new ZipFile(jarFile)) {
          ZipEntry targetEntry = zipFile.getEntry(TARGET_CLASS_ENTRY);
          if (targetEntry != null) {
            candidates.add(readAllBytes(zipFile.getInputStream(targetEntry)));
            locations.add(jarFile.getAbsolutePath() + "!/" + TARGET_CLASS_ENTRY);
          }
        } catch (IOException error) {
          throw new GradleException(
              "[drawing-order-guard] Unable to inspect class jar " + jarFile, error);
        }
      }

      for (Directory directory : getAllDirectories().get()) {
        File targetFile = new File(directory.getAsFile(), TARGET_CLASS_ENTRY);
        if (targetFile.isFile()) {
          try {
            candidates.add(Files.readAllBytes(targetFile.toPath()));
            locations.add(targetFile.getAbsolutePath());
          } catch (IOException error) {
            throw new GradleException(
                "[drawing-order-guard] Unable to inspect class file " + targetFile, error);
          }
        }
      }

      if (candidates.size() != 1) {
        throw new GradleException(
            "[drawing-order-guard] Expected exactly one instrumented ReactSwipeRefreshLayout class, found "
                + candidates.size()
                + " at "
                + locations
                + ".");
      }
      verifyInstrumentedClass(candidates.get(0));
      getLogger()
          .lifecycle(
              "[drawing-order-guard] Verified instrumented ReactSwipeRefreshLayout output for {}.",
              getVariantName().get());
    }
  }

  private static void verifyOriginalClassShape(byte[] classBytes) {
    final int[] guardMethodCount = {0};
    new ClassReader(classBytes)
        .accept(
            new ClassVisitor(Opcodes.ASM9) {
              @Override
              public void visit(
                  int version,
                  int access,
                  String name,
                  String signature,
                  String superName,
                  String[] interfaces) {
                if (version != Opcodes.V17
                    || access != (Opcodes.ACC_PUBLIC | Opcodes.ACC_FINAL | Opcodes.ACC_SUPER)
                    || !TARGET_CLASS_INTERNAL_NAME.equals(name)
                    || !TARGET_SUPER_INTERNAL_NAME.equals(superName)
                    || interfaces.length != 0) {
                  throw new GradleException(
                      "[drawing-order-guard] Official ReactSwipeRefreshLayout class shape changed.");
                }
              }

              @Override
              public MethodVisitor visitMethod(
                  int access,
                  String name,
                  String descriptor,
                  String signature,
                  String[] exceptions) {
                if (METHOD_NAME.equals(name) && METHOD_DESCRIPTOR.equals(descriptor)) {
                  guardMethodCount[0]++;
                }
                return null;
              }
            },
            ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
    if (guardMethodCount[0] != 0) {
      throw new GradleException(
          "[drawing-order-guard] Official input already defines getChildDrawingOrder(II)I.");
    }
  }

  private static void verifyInstrumentedClass(byte[] classBytes) {
    List<String> actualOperations = new ArrayList<>();
    final int[] guardMethodCount = {0};
    final int[] guardAccess = {0};
    new ClassReader(classBytes)
        .accept(
            new ClassVisitor(Opcodes.ASM9) {
              @Override
              public void visit(
                  int version,
                  int access,
                  String name,
                  String signature,
                  String superName,
                  String[] interfaces) {
                if (!TARGET_CLASS_INTERNAL_NAME.equals(name)
                    || !TARGET_SUPER_INTERNAL_NAME.equals(superName)) {
                  throw new GradleException(
                      "[drawing-order-guard] Instrumented target class or superclass changed.");
                }
              }

              @Override
              public MethodVisitor visitMethod(
                  int access,
                  String name,
                  String descriptor,
                  String signature,
                  String[] exceptions) {
                if (!METHOD_NAME.equals(name) || !METHOD_DESCRIPTOR.equals(descriptor)) {
                  return null;
                }
                guardMethodCount[0]++;
                guardAccess[0] = access;
                return new OperationRecordingMethodVisitor(actualOperations);
              }
            },
            ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);

    if (guardMethodCount[0] != 1
        || (guardAccess[0] & Opcodes.ACC_PUBLIC) == 0
        || (guardAccess[0]
                & (Opcodes.ACC_STATIC | Opcodes.ACC_ABSTRACT | Opcodes.ACC_NATIVE))
            != 0) {
      throw new GradleException(
          "[drawing-order-guard] Instrumented output must contain exactly one public instance getChildDrawingOrder(II)I method.");
    }

    List<String> expectedOperations =
        List.of(
            operation("VAR", Opcodes.ALOAD, 0),
            operation("VAR", Opcodes.ILOAD, 1),
            operation("VAR", Opcodes.ILOAD, 2),
            "METHOD "
                + Opcodes.INVOKESPECIAL
                + " "
                + TARGET_SUPER_INTERNAL_NAME
                + " "
                + METHOD_NAME
                + " "
                + METHOD_DESCRIPTOR
                + " false",
            operation("VAR", Opcodes.ISTORE, 3),
            operation("VAR", Opcodes.ILOAD, 3),
            "JUMP " + Opcodes.IFLT + " L0",
            operation("VAR", Opcodes.ILOAD, 3),
            operation("VAR", Opcodes.ILOAD, 1),
            "JUMP " + Opcodes.IF_ICMPGE + " L0",
            operation("VAR", Opcodes.ILOAD, 3),
            operation("INSN", Opcodes.IRETURN),
            "LABEL L0",
            operation("VAR", Opcodes.ILOAD, 2),
            operation("INSN", Opcodes.IRETURN));
    if (!expectedOperations.equals(actualOperations)) {
      throw new GradleException(
          "[drawing-order-guard] Instrumented method bytecode does not match the guarded fallback contract: "
              + actualOperations);
    }
  }

  static final class OperationRecordingMethodVisitor extends MethodVisitor {
    private final List<String> operations;
    private final Map<Label, Integer> labelIds = new IdentityHashMap<>();

    OperationRecordingMethodVisitor(List<String> operations) {
      super(Opcodes.ASM9);
      this.operations = operations;
    }

    @Override
    public void visitInsn(int opcode) {
      operations.add(operation("INSN", opcode));
    }

    @Override
    public void visitIntInsn(int opcode, int operand) {
      operations.add(operation("INT", opcode, operand));
    }

    @Override
    public void visitVarInsn(int opcode, int variable) {
      operations.add(operation("VAR", opcode, variable));
    }

    @Override
    public void visitTypeInsn(int opcode, String type) {
      operations.add("TYPE " + opcode + " " + type);
    }

    @Override
    public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
      operations.add("FIELD " + opcode + " " + owner + " " + name + " " + descriptor);
    }

    @Override
    public void visitMethodInsn(
        int opcode, String owner, String name, String descriptor, boolean isInterface) {
      operations.add(
          "METHOD "
              + opcode
              + " "
              + owner
              + " "
              + name
              + " "
              + descriptor
              + " "
              + isInterface);
    }

    @Override
    public void visitInvokeDynamicInsn(
        String name, String descriptor, Handle bootstrapMethodHandle, Object... arguments) {
      operations.add("INVOKEDYNAMIC");
    }

    @Override
    public void visitJumpInsn(int opcode, Label label) {
      operations.add("JUMP " + opcode + " L" + labelId(label));
    }

    @Override
    public void visitLabel(Label label) {
      operations.add("LABEL L" + labelId(label));
    }

    @Override
    public void visitLdcInsn(Object value) {
      operations.add("LDC " + value);
    }

    @Override
    public void visitIincInsn(int variable, int increment) {
      operations.add(operation("IINC", variable, increment));
    }

    @Override
    public void visitTableSwitchInsn(int minimum, int maximum, Label defaultLabel, Label... labels) {
      operations.add("TABLESWITCH");
    }

    @Override
    public void visitLookupSwitchInsn(Label defaultLabel, int[] keys, Label[] labels) {
      operations.add("LOOKUPSWITCH");
    }

    @Override
    public void visitMultiANewArrayInsn(String descriptor, int dimensions) {
      operations.add("MULTIANEWARRAY " + descriptor + " " + dimensions);
    }

    @Override
    public void visitTryCatchBlock(Label start, Label end, Label handler, String type) {
      operations.add("TRYCATCH " + type);
    }

    private int labelId(Label label) {
      return labelIds.computeIfAbsent(label, ignored -> labelIds.size());
    }
  }

  private static String operation(String kind, int... values) {
    StringBuilder builder = new StringBuilder(kind);
    for (int value : values) {
      builder.append(' ').append(value);
    }
    return builder.toString();
  }

  private static byte[] readTargetClassFromAar(File aarFile) {
    try (ZipFile aar = new ZipFile(aarFile)) {
      for (String requiredEntry : REQUIRED_NATIVE_ENTRIES) {
        if (aar.getEntry(requiredEntry) == null) {
          throw new GradleException(
              "[drawing-order-guard] Official ReactAndroid AAR is missing " + requiredEntry + ".");
        }
      }

      List<? extends ZipEntry> classesJarEntries =
          Collections.list(aar.entries()).stream()
              .filter(entry -> "classes.jar".equals(entry.getName()))
              .toList();
      if (classesJarEntries.size() != 1) {
        throw new GradleException(
            "[drawing-order-guard] ReactAndroid AAR must contain exactly one classes.jar.");
      }

      byte[] classesJar = readAllBytes(aar.getInputStream(classesJarEntries.get(0)));
      List<byte[]> targetClasses = new ArrayList<>();
      try (JarInputStream jarInput =
          new JarInputStream(new ByteArrayInputStream(classesJar))) {
        JarEntry entry;
        while ((entry = jarInput.getNextJarEntry()) != null) {
          if (TARGET_CLASS_ENTRY.equals(entry.getName())) {
            targetClasses.add(readAllBytes(jarInput));
          }
        }
      }
      if (targetClasses.size() != 1) {
        throw new GradleException(
            "[drawing-order-guard] ReactAndroid classes.jar must contain exactly one target class.");
      }
      return targetClasses.get(0);
    } catch (IOException error) {
      throw new GradleException(
          "[drawing-order-guard] Unable to inspect ReactAndroid AAR " + aarFile, error);
    }
  }

  private static byte[] readAllBytes(InputStream input) throws IOException {
    try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      input.transferTo(output);
      return output.toByteArray();
    }
  }

  private static String sha256(File file) {
    try (InputStream input = Files.newInputStream(file.toPath())) {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] buffer = new byte[1024 * 1024];
      int read;
      while ((read = input.read(buffer)) >= 0) {
        if (read > 0) {
          digest.update(buffer, 0, read);
        }
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (IOException | NoSuchAlgorithmException error) {
      throw new GradleException("[drawing-order-guard] Unable to hash " + file, error);
    }
  }

  private static String sha256(byte[] bytes) {
    try {
      return HexFormat.of()
          .formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException error) {
      throw new GradleException("[drawing-order-guard] SHA-256 is unavailable.", error);
    }
  }
}
