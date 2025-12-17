export const useInAppUpdate = () => {
    // No-op for web
    // This file exists to avoid importing 'sp-react-native-in-app-updates' on web,
    // which causes build errors because the library has no web implementation.
};
