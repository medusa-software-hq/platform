import * as pulumi from '@pulumi/pulumi';
import {
  appDeployEnvironments,
  deployEnvironmentName,
  deployTokenSecretName,
} from './app-deploy.ts';
import { appEnvironments } from './app-environment.ts';
import { appHostnames } from './app-hostname.ts';
import { appImages, githubPoolProvider } from './app-images.ts';
import { appRepositories } from './app-repository.ts';
import { centralProject } from './central.ts';
import { appFolders, sharedFolder } from './folders.ts';
import { billingAccount, organization } from './organization.ts';

export const organizationId = organization.orgId;
export const billingAccountId = billingAccount.id;

export const sharedFolderId = sharedFolder.folderId;
export const centralProjectId = centralProject.projectId;

export const appFolderIds = Object.fromEntries(
  Object.entries(appFolders).map(([key, folder]) => [key, folder.folderId]),
);

export const appProjectIds = Object.fromEntries(
  Object.entries(appEnvironments).map(([key, appEnvironment]) => [
    key,
    appEnvironment.project.projectId,
  ]),
);

export const appServiceAccountEmails = Object.fromEntries(
  Object.entries(appEnvironments).map(([key, appEnvironment]) => [
    key,
    appEnvironment.serviceAccount.email,
  ]),
);

//region Handed to app repositories, for pushing images

export const imagePushProvider = githubPoolProvider.name;

export const imageRegistries = Object.fromEntries(
  Object.entries(appImages).map(([app, images]) => [
    app,
    pulumi.interpolate`${images.registry.location}-docker.pkg.dev/${centralProject.projectId}/${images.registry.repositoryId}`,
  ]),
);

export const imagePushServiceAccountEmails = Object.fromEntries(
  Object.entries(appImages).map(([app, images]) => [app, images.pushServiceAccount.email]),
);

//endregion

export const appRepositoryNames = Object.fromEntries(
  Object.entries(appRepositories).map(([app, repository]) => [app, repository.fullName]),
);

/** Where each app environment is served. */
export const appHostnameUrls = Object.fromEntries(
  Object.entries(appHostnames).map(([key, hostname]) => [key, `https://${hostname}`]),
);

/**
 * Which GitHub environment each app's workflow names to reach its Pulumi credential,
 * and what the secret in it is called. The value is set by hand and is not this
 * stack's to know.
 */
export const appDeployCredentials = Object.fromEntries(
  Object.entries(appDeployEnvironments).map(([app]) => [
    app,
    { environment: deployEnvironmentName, secret: deployTokenSecretName },
  ]),
);
