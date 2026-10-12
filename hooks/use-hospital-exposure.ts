import { useIsFocused } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { platformRequest, type PlatformHospital } from '@/lib/platform-api';

let browsingSessionId: string | undefined;

export function recordHospitalEvent(hospital: PlatformHospital, eventType: 'impression' | 'detail' | 'phone' | 'directions', sessionId: string) {
  // Measurement failure must never block browsing, contact or directions.
  void platformRequest('record_hospital_event', {
    hospitalId: hospital.id, measurementToken: hospital.measurementToken, placement: hospital.adPlacement,
    eventId: randomUUID(), sessionId, eventType,
  }).catch(() => undefined);
}

/** Measure only a focused, active screen after continuously visible content for one second. */
export function useHospitalExposure(hospitals: PlatformHospital[], eventType: 'impression' | 'detail' = 'impression') {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active' && (Platform.OS !== 'web' || typeof document === 'undefined' || document.visibilityState !== 'hidden'));
  const [sessionId] = useState(() => browsingSessionId ??= randomUUID());
  const recorded = useRef(new Set<string>());
  useEffect(() => {
    const update = () => setActive(AppState.currentState === 'active' && (Platform.OS !== 'web' || typeof document === 'undefined' || document.visibilityState !== 'hidden'));
    const subscription = AppState.addEventListener('change', update);
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', update);
    return () => {
      subscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    if (!focused || !active) return;
    const timers = hospitals.filter((hospital) => !recorded.current.has(`${eventType}:${hospital.id}:${hospital.revision}:${hospital.adPlacement}`)).map((hospital) => setTimeout(() => {
      recorded.current.add(`${eventType}:${hospital.id}:${hospital.revision}:${hospital.adPlacement}`);
      recordHospitalEvent(hospital, eventType, sessionId);
    }, 1000));
    return () => timers.forEach(clearTimeout);
  }, [hospitals, focused, active, eventType, sessionId]);
  return sessionId;
}
