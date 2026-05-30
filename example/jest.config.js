module.exports = {
  preset: 'react-native',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  transform: { '^.+\\.tsx?$': 'ts-jest' },
  globals: { 'ts-jest': { tsconfig: { jsx: 'react' } } },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
  ],
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  moduleNameMapper: {
    'react-native-vision-camera': '<rootDir>/__mocks__/visionCamera.js',
  },
};
