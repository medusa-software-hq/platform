import { deployIdentity } from './app-deploy.ts';
import type { AppEnvironment } from './app-environment.ts';
import { githubPoolProvider } from './app-images.ts';
import { AppComponent } from './app.ts';
import { centralProject } from './central.ts';
import { sharedFolder } from './folders.ts';
import { APPS } from './model.ts';
import { billingAccount, organization } from './organization.ts';

export const organizationId = organization.orgId;
export const billingAccountId = billingAccount.id;

export const sharedFolderId = sharedFolder.folderId;
export const centralProjectId = centralProject.projectId;

/** Every app, each holding its environments. */
const apps: readonly AppComponent[] = APPS.map((app) => new AppComponent(app));

const appEnvironments = apps.flatMap((app) => Object.values(app.environments));

/** One output per app, keyed by the app. */
const byApp = <T>(value: (app: AppComponent) => T): Record<string, T> =>
  Object.fromEntries(apps.map((app) => [app.app, value(app)]));

/** One output per app environment, keyed as `<app>-<environment>`. */
const byAppEnvironmentKey = <T>(value: (appEnvironment: AppEnvironment) => T): Record<string, T> =>
  Object.fromEntries(
    appEnvironments.map((appEnvironment) => [appEnvironment.key, value(appEnvironment)]),
  );

export const appFolderIds = byAppEnvironmentKey((environment) => environment.folder.folderId);

export const appProjectIds = byAppEnvironmentKey((environment) => environment.project.projectId);

export const appServiceAccountEmails = byAppEnvironmentKey(
  (environment) => environment.serviceAccount.email,
);

//region Handed to app repositories, for pushing images

export const imagePushProvider = githubPoolProvider.name;

export const imageRegistries = byApp((app) => app.images.path);

export const imagePushServiceAccountEmails = byApp((app) => app.images.pushServiceAccount.email);

//endregion

export const appRepositoryNames = byApp((app) => app.repository.fullName);

/** Where each app environment is served. */
export const appHostnameUrls = byAppEnvironmentKey(
  (environment) => `https://${environment.hostname.hostname}`,
);

/** What an app's deploy workflow federates with, and where the token it reads lives. */
export const deployWorkloadIdentity = deployIdentity;
