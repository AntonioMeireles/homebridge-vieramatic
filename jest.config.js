module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  verbose: true,
  collectCoverageFrom: ["src/*.ts"],
  testMatch: ["**/?(*.)+(spec|test).ts"],
  transform: {
    '^.+\\.tsx?$': [
      'esbuild-jest', {
        "sourcemap": true
      }
    ]
  }
}
