import { appFolders, sharedFolder } from './folders.ts';
import { billingAccount, organization } from './organization.ts';

export const organizationId = organization.orgId;
export const billingAccountId = billingAccount.id;

export const sharedFolderId = sharedFolder.folderId;
export const appFolderIds = Object.fromEntries(
  Object.entries(appFolders).map(([key, value]) => [key, value.folderId]),
);
