module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  verbose: true,
  collectCoverageFrom: ["src/*.ts"],
  testMatch: ["**/?(*.)+(spec|test).ts"]
}
