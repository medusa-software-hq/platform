import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import { centralProject, centralServices } from './central.ts';
import { billingAccount, organization } from './organization.ts';

/**
 * The identity this stack runs as.
 *
 * Pulumi Cloud mints an OIDC token, GCP exchanges it, and the result impersonates a
 * service account here. No key exists anywhere: not in the repository, not in GitHub,
 * not on a laptop. The same path serves a local `up` and a Deployments run, so there
 * is one way in rather than two.
 *
 * It grants itself the rights it runs with, which is a boundary only by convention —
 * an identity that can widen its own permissions is not contained by them. This
 * belongs one layer up, in the stack that owns the delegation folder, and should move
 * there once that stack exists.
 */

const config = new pulumi.Config();
const delegationFolder = config.require('delegationFolder');

/** Pulumi Cloud organization, which is also the audience it issues tokens for. */
const pulumiOrganization = config.require('pulumiOrganization');

const dependsOn = { dependsOn: centralServices };

export const pool = new gcp.iam.WorkloadIdentityPool(
  'pulumi-cloud',
  {
    project: centralProject.projectId,
    workloadIdentityPoolId: 'pulumi-cloud',
    displayName: 'Pulumi Cloud',
    description: 'Identities issued by Pulumi Cloud for this organization.',
  },
  dependsOn,
);

export const poolProvider = new gcp.iam.WorkloadIdentityPoolProvider(
  'pulumi-cloud',
  {
    project: centralProject.projectId,
    workloadIdentityPoolId: pool.workloadIdentityPoolId,
    workloadIdentityPoolProviderId: 'pulumi-cloud',
    displayName: 'Pulumi Cloud',

    attributeMapping: {
      'google.subject': 'assertion.sub',
      // Constant for a given Pulumi organization, which is what the binding below
      // keys on. The subject also carries the organization, but its shape is set by
      // Pulumi and reads as an encoded attribute list, so it is a poor thing to pin.
      'attribute.pulumi_audience': 'assertion.aud',
    },

    oidc: {
      issuerUri: 'https://api.pulumi.com/oidc',
      // ESC prefixes the organization; Pulumi will not issue a token for any other
      // value, so this is the discriminator that matters.
      allowedAudiences: [`gcp:${pulumiOrganization}`],
    },
  },
  dependsOn,
);

export const platformServiceAccount = new gcp.serviceaccount.Account(
  'platform',
  {
    project: centralProject.projectId,
    accountId: 'platform',
    displayName: 'Platform',
    description: 'Runs the platform stack.',
  },
  dependsOn,
);

/**
 * The attribute value must be URL encoded. Pulumi's audience contains a colon, and an
 * unencoded one silently fails to match: the token exchange succeeds and only the
 * impersonation that follows is denied, which reads like a missing role rather than a
 * malformed principal.
 */
const audience = encodeURIComponent(`gcp:${pulumiOrganization}`);

new gcp.serviceaccount.IAMMember('platform-workload-identity', {
  serviceAccountId: platformServiceAccount.name,
  role: 'roles/iam.workloadIdentityUser',
  member: pulumi.interpolate`principalSet://iam.googleapis.com/${pool.name}/attribute.pulumi_audience/${audience}`,
});

//region Permissions

/** Read-only organization metadata, so the organization and its folders resolve. */
new gcp.organizations.IAMMember('platform-browser', {
  orgId: organization.orgId,
  role: 'roles/browser',
  member: platformServiceAccount.member,
});

/**
 * Manage the hierarchy and create projects, but only beneath the delegated folder.
 * Both roles are grantable on a folder, which is why nothing here needs organization
 * level write access.
 */
for (const role of ['roles/resourcemanager.folderAdmin', 'roles/resourcemanager.projectCreator']) {
  new gcp.folder.IAMMember(`platform-${role.split('.')[1]}`, {
    folder: delegationFolder,
    role,
    member: platformServiceAccount.member,
  });
}

/** Attach billing to projects this stack creates. */
new gcp.billing.AccountIamMember('platform-billing-user', {
  billingAccountId: billingAccount.id,
  role: 'roles/billing.user',
  member: platformServiceAccount.member,
});

//endregion

export const workloadIdentityPoolId = pool.workloadIdentityPoolId;
export const workloadIdentityProviderId = poolProvider.workloadIdentityPoolProviderId;
export const platformServiceAccountEmail = platformServiceAccount.email;
export const centralProjectNumber = centralProject.number;
