import * as gcp from '@pulumi/gcp';
import * as random from '@pulumi/random';
import { sharedFolder } from './folders.ts';
import { billingAccount } from './organization.ts';

/**
 * The one project that is not an app's. It holds what every app needs and nobody owns:
 * the identity Pulumi Cloud federates into, and later the shared container registry.
 */

const suffix = new random.RandomId('central-project-suffix', { byteLength: 4 });

export const centralProject = new gcp.organizations.Project('central', {
  name: 'central',
  projectId: suffix.hex.apply((hex) => `ms-central-${hex}`),
  folderId: sharedFolder.folderId,
  billingAccount: billingAccount.id,

  // Exploration phase: `destroy` should actually destroy. Worth revisiting before
  // anything here matters.
  deletionPolicy: 'DELETE',
});

/** Only what this project hosts itself; apps enable their own. */
export const centralServices = [
  'cloudbilling.googleapis.com',
  'cloudresourcemanager.googleapis.com',
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
  'serviceusage.googleapis.com',
  'sts.googleapis.com',
].map(
  (service) =>
    new gcp.projects.Service(`central-${service}`, {
      project: centralProject.projectId,
      service,
      disableOnDestroy: false,
    }),
);
