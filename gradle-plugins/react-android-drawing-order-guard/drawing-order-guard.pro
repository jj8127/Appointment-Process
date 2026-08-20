# Keep the injected framework override stable so the final AAB can be verified by name and descriptor.
-keep class com.facebook.react.views.swiperefresh.ReactSwipeRefreshLayout {
    public int getChildDrawingOrder(int,int);
}
