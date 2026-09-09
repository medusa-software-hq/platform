/**
 * What this organization has. Adding an app is a one-line change here; everything that
 * follows — folders, projects, identities — is derived from it.
 */

export const ENVIRONMENTS = ['production', 'staging'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Terse forms, for identifiers with length limits: project IDs and hostnames. */
export const ENVIRONMENT_SHORT_NAMES: Readonly<Record<Environment, string>> = {
  production: 'prod',
  staging: 'stg',
};

export const APPS = ['demo'] as const;
export type App = (typeof APPS)[number];

export type AppEnvironmentKey = `${App}-${Environment}`;

export const appEnvironmentKey = (app: App, environment: Environment): AppEnvironmentKey =>
  `${app}-${environment}`;

export interface AppEnvironmentPair {
  app: App;
  environment: Environment;
  key: AppEnvironmentKey;
}

/** Every app in every environment, in a stable order. */
export const appEnvironments = (): AppEnvironmentPair[] =>
  APPS.flatMap((app) =>
    ENVIRONMENTS.map((environment) => ({
      app,
      environment,
      key: appEnvironmentKey(app, environment),
    })),
  );

export const byEnvironment = <T>(make: (environment: Environment) => T): Record<Environment, T> =>
  Object.fromEntries(ENVIRONMENTS.map((environment) => [environment, make(environment)])) as Record<
    Environment,
    T
  >;

export const byAppEnvironment = <T>(
  make: (pair: AppEnvironmentPair) => T,
): Record<AppEnvironmentKey, T> =>
  Object.fromEntries(appEnvironments().map((pair) => [pair.key, make(pair)])) as Record<
    AppEnvironmentKey,
    T
  >;
