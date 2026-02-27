import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Image, StyleSheet, View } from 'react-native';

const ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const { width: W } = Dimensions.get('window');

const DOT_R = 7;
const H_PAD = 24;
const LOGO_BAR_GAP = 12;

// login.png is a wide logo (~2.5:1). bigLogo container width = W*0.5
// Small logo displayed width (determines scale + target position)
const SMALL_LOGO_W = 60;
const SMALL_SCALE = SMALL_LOGO_W / (W * 0.5);

// After logo moves left: its center sits at H_PAD + SMALL_LOGO_W/2
// Big logo center starts at W/2  →  need to shift by:
const TARGET_X = H_PAD + SMALL_LOGO_W / 2 - W / 2;

// Progress bar starts right after the small logo
const BAR_LEFT = H_PAD + SMALL_LOGO_W + LOGO_BAR_GAP;
const BAR_W = W - BAR_LEFT - H_PAD;

type Props = { onDone: () => void };

export default function SplashAnimation({ onDone }: Props) {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.65)).current;
  const logoTranslateX = useRef(new Animated.Value(0)).current;
  const rowOpacity = useRef(new Animated.Value(0)).current;
  const fillWidth = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Phase 1: logo springs in at center
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, tension: 60, friction: 7, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      const t1 = setTimeout(() => {
        // Phase 2: logo shrinks + slides to left (YouTube-style)
        Animated.parallel([
          Animated.timing(logoScale, { toValue: SMALL_SCALE, duration: 420, useNativeDriver: true }),
          Animated.timing(logoTranslateX, { toValue: TARGET_X, duration: 420, useNativeDriver: true }),
        ]).start(() => {
          // Phase 3: progress bar fades in + fills
          Animated.timing(rowOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
          Animated.timing(fillWidth, {
            toValue: BAR_W,
            duration: 900,
            useNativeDriver: false,
          }).start(() => {
            const t2 = setTimeout(() => {
              // Phase 4: fade out everything
              Animated.timing(overlayOpacity, { toValue: 0, duration: 350, useNativeDriver: true }).start(
                () => onDone(),
              );
            }, 250);
            timers.push(t2);
          });
        });
      }, 350);
      timers.push(t1);
    });

    return () => timers.forEach(clearTimeout);
  }, [logoOpacity, logoScale, logoTranslateX, rowOpacity, fillWidth, overlayOpacity, onDone]);

  const dotLeft = fillWidth.interpolate({
    inputRange: [0, BAR_W],
    outputRange: [0, BAR_W - DOT_R * 2],
  });

  const scrubberLeft = fillWidth.interpolate({
    inputRange: [0, BAR_W],
    outputRange: [0, W - DOT_R * 2],
  });

  return (
    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
      <View style={{ flex: 1 }}>
        {/* Logo: starts big+center, shrinks+moves left in Phase 2
            translateX is applied in screen coords (outer), scale in local (inner) */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.center, { opacity: logoOpacity }]}>
          <Animated.View style={{ transform: [{ translateX: logoTranslateX }] }}>
            <Animated.View style={{ transform: [{ scale: logoScale }] }}>
              <Image
                source={require('../assets/images/login.png')}
                style={styles.bigLogo}
                resizeMode="contain"
              />
            </Animated.View>
          </Animated.View>
        </Animated.View>

        {/* Progress bar — fades in once logo reaches left position */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: rowOpacity,
              justifyContent: 'center',
              paddingLeft: BAR_LEFT,
              paddingRight: H_PAD,
            },
          ]}>
          <View style={styles.barWrap}>
            <View style={styles.track} />
            <Animated.View style={[styles.fill, { width: fillWidth }]} />
            <Animated.View style={[styles.dot, { left: dotLeft }]} />
          </View>
        </Animated.View>
      </View>

      {/* Bottom scrubber dot */}
      <Animated.View style={[styles.scrubberRow, { opacity: rowOpacity }]}>
        <View style={styles.scrubberTrack} />
        <Animated.View style={[styles.scrubberDot, { left: scrubberLeft }]} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    zIndex: 9999,
    elevation: 9999,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigLogo: {
    width: W * 0.5,
    height: W * 0.25,
  },
  barWrap: {
    height: DOT_R * 2,
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: DOT_R - 1.5,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderRadius: 1.5,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: DOT_R - 1.5,
    height: 3,
    backgroundColor: ORANGE,
    borderRadius: 1.5,
  },
  dot: {
    position: 'absolute',
    top: 0,
    width: DOT_R * 2,
    height: DOT_R * 2,
    borderRadius: DOT_R,
    backgroundColor: ORANGE,
  },
  scrubberRow: {
    height: DOT_R * 2,
    marginBottom: 10,
  },
  scrubberTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: DOT_R - 1,
    height: 2,
    backgroundColor: 'rgba(0,0,0,0.10)',
  },
  scrubberDot: {
    position: 'absolute',
    top: 0,
    width: DOT_R * 2,
    height: DOT_R * 2,
    borderRadius: DOT_R,
    backgroundColor: ORANGE,
  },
});
