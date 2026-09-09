import * as gcp from '@pulumi/gcp';
import * as random from '@pulumi/random';
import { sharedFolder } from './folders.ts';
import { billingAccount } from './organization.ts';

/**
 * The one project that belongs to no app.
 *
 * It holds what apps need but must not own: the accounts they deploy with, and later
 * the registry their images are promoted through. Keeping those here rather than in an
 * app's own project is the point — an app holds broad rights inside its project, so
 * anything kept alongside is something it could rewrite.
 */

const suffix = new random.RandomId('central-project-suffix', { byteLength: 4 });

export const centralProject = new gcp.organizations.Project('central', {
  name: 'central',
  projectId: suffix.hex.apply((hex) => `ms-central-${hex}`),
  folderId: sharedFolder.folderId,
  billingAccount: billingAccount.id,

  // Exploration phase: `destroy` should actually destroy.
  deletionPolicy: 'DELETE',
});

export const centralServices = [
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
