// Jest setup: in-memory AsyncStorage so storage-backed code can be tested.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
