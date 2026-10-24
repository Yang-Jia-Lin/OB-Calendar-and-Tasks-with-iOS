const path = require('node:path');

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/Src'],
  testEnvironment: require.resolve('jest-environment-jsdom'),
  transform: { '^.+\\.tsx?$': [require.resolve('ts-jest'), { tsconfig: '<rootDir>/Src/tsconfig.json' }] },
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/Src/Reference/'],
  coverageDirectory: '<rootDir>/Results/Coverage',
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/Src/Testing/Mocks/obsidian.ts',
    '\\.css$': '<rootDir>/Src/Testing/Mocks/styleMock.js',
    '\\.md$': '<rootDir>/Src/Testing/Mocks/mdMock.js',
    '^obsidian-journals-api$': '<rootDir>/Src/Testing/Mocks/obsidianJournalsApi.js'
  }
};
