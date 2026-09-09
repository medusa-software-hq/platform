import { appEnvironments } from './app-environment.ts';
import { appFolders, sharedFolder } from './folders.ts';
import { billingAccount, organization } from './organization.ts';

export const organizationId = organization.orgId;
export const billingAccountId = billingAccount.id;

export const sharedFolderId = sharedFolder.folderId;

export const appFolderIds = Object.fromEntries(
  Object.entries(appFolders).map(([key, folder]) => [key, folder.folderId]),
);

export const appProjectIds = Object.fromEntries(
  Object.entries(appEnvironments).map(([key, appEnvironment]) => [
    key,
    appEnvironment.project.projectId,
  ]),
);
