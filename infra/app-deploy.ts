import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import { centralProject, centralServices } from './central.ts';
import { APPS, type App } from './model.ts';
import { githubOrganization, organizationAdmins } from './organization.ts';

/**
 * How an app's repository comes to hold a Pulumi credential without ever holding it.
 *
 * An app deploys its environments in an order, which means something has to start
 * those deployments, which means a Pulumi credential. This account can issue only
 * personal access tokens — it is a personal account rather than an organization, so it
 * has neither teams nor organization tokens — and a personal token carries everything:
 * every stack, including the ones that grant an app its rights.
 *
 * Nothing makes that token narrower, so nothing is trusted with it. It is kept here,
 * and the only thing that can read it is one workflow file, in this repository, at one
 * ref. An app does not hold the token and cannot be given it; it can only ask that
 * workflow to run, and that workflow will only ever deploy the app that asked.
 *
 * The trust boundary that matters is therefore this repository's review, not an app's.
 * Changing what happens to the token takes a pull request here.
 */

const dependsOn = { dependsOn: centralServices };

/** This repository, which holds the workflow the token is issued to. */
const PLATFORM_REPOSITORY = 'platform';

/** The one workflow, at the one ref, that may read it. */
const DEPLOY_WORKFLOW_REF = `${githubOrganization}/${PLATFORM_REPOSITORY}/.github/workflows/deploy.yml@refs/heads/main`;

/** The one branch a caller may run it from. */
const CALLER_REF = 'refs/heads/main';

/**
 * A pool of its own, not the one images are pushed from.
 *
 * The same reasoning that separated that one: an identity minted for pushing an image
 * must not also satisfy this, and the surest way to guarantee that is for the two to
 * share no namespace. This pool admits far less than that one does.
 */
export const deployPool = new gcp.iam.WorkloadIdentityPool(
  'github-deploy',
  {
    project: centralProject.projectId,
    workloadIdentityPoolId: 'github-deploy',
    displayName: 'GitHub Actions deployments',
    description: 'Identities issued to the deploy workflow, and to nothing else.',
  },
  dependsOn,
);

export const deployPoolProvider = new gcp.iam.WorkloadIdentityPoolProvider(
  'github-deploy',
  {
    project: centralProject.projectId,
    workloadIdentityPoolId: deployPool.workloadIdentityPoolId,
    workloadIdentityPoolProviderId: 'github-deploy',
    displayName: 'GitHub Actions deployments',

    attributeMapping: {
      'google.subject': 'assertion.sub',
      // Which repository asked. Bound per app below, so an app's identity is its own.
      'attribute.repository': 'assertion.repository',
    },

    /**
     * Three claims, because one is not enough.
     *
     * `job_workflow_ref` names the workflow that defines the running job, which for a
     * called workflow is the called one — so this pins the file and the ref it is read
     * from, and a caller cannot substitute its own steps. The other two describe the
     * caller: `repository_owner` because these repositories are public and anyone at
     * all may call a public workflow, and `ref` because a deployment should come from
     * a merge rather than from a branch or a fork.
     */
    attributeCondition: [
      `assertion.repository_owner == '${githubOrganization}'`,
      `assertion.ref == '${CALLER_REF}'`,
      `assertion.job_workflow_ref == '${DEPLOY_WORKFLOW_REF}'`,
    ].join(' && '),

    oidc: { issuerUri: 'https://token.actions.githubusercontent.com' },
  },
  dependsOn,
);

/**
 * The token itself, held where no repository can see it.
 *
 * Only the container is declared. The value is a personal access token minted by a
 * person in the Pulumi console — there is no API this stack could call — and putting
 * it in this program would put it in this stack's state and in every plan that reads
 * it, which is the wrong place for a credential that opens every other one.
 *
 * Versions are deliberately not managed here either. Rotating the token is adding a
 * version, which is a thing a person does, and this stack should not fight them for it.
 */
export const deployTokenSecret = new gcp.secretmanager.Secret(
  'pulumi-deploy-token',
  {
    project: centralProject.projectId,
    secretId: 'pulumi-deploy-token',
    replication: { auto: {} },
  },
  dependsOn,
);

/**
 * Impersonated rather than granted directly: reading a secret needs an OAuth access
 * token, and those are issued for service accounts.
 */
export const deployServiceAccount = new gcp.serviceaccount.Account(
  'pulumi-deploy',
  {
    project: centralProject.projectId,
    accountId: 'pulumi-deploy',
    displayName: 'Pulumi deploy',
    description: 'Reads the Pulumi token, for the deploy workflow and nothing else.',
  },
  dependsOn,
);

/**
 * Who may put a token in, which is not who may read one.
 *
 * The value arrives by hand, on purpose — a personal access token is minted by a
 * person in the Pulumi console, and writing it into this program would put it in this
 * stack's state and in every plan that reads it. But central belongs to the account
 * this stack deploys with, so administering the organization grants nothing inside it,
 * and without saying so nobody can supply the value at all.
 *
 * The role carries `secretmanager.versions.add` and not `versions.access`, so whoever
 * supplies the credential cannot read it back afterwards. Nothing can, except the
 * account the deploy workflow federates into.
 */
const SECRET_KEEPER = organizationAdmins;

new gcp.secretmanager.SecretIamMember('pulumi-deploy-token-keeper', {
  project: centralProject.projectId,
  secretId: deployTokenSecret.secretId,
  role: 'roles/secretmanager.secretVersionAdder',
  member: SECRET_KEEPER,
});

new gcp.secretmanager.SecretIamMember('pulumi-deploy-token-accessor', {
  project: centralProject.projectId,
  secretId: deployTokenSecret.secretId,
  role: 'roles/secretmanager.secretAccessor',
  member: deployServiceAccount.member,
});

/**
 * One binding per app, on the repository that asked.
 *
 * The pool's condition already admits nothing but the deploy workflow, so this adds
 * the other half: which repositories may call it at all. A repository that is not an
 * app of this organization gets no identity even if it copies the workflow reference
 * exactly.
 */
for (const app of APPS) {
  new gcp.serviceaccount.IAMMember(`${app}-deploy-workload-identity`, {
    serviceAccountId: deployServiceAccount.name,
    role: 'roles/iam.workloadIdentityUser',
    member: pulumi.interpolate`principalSet://iam.googleapis.com/${deployPool.name}/attribute.repository/${githubOrganization}/${app}`,
  });
}

/** What an app's workflow needs in order to ask for that identity. */
export interface DeployIdentity {
  provider: pulumi.Output<string>;
  serviceAccount: pulumi.Output<string>;
  secret: pulumi.Output<string>;
}

export const deployIdentity: DeployIdentity = {
  provider: deployPoolProvider.name,
  serviceAccount: deployServiceAccount.email,
  secret: pulumi.interpolate`projects/${centralProject.projectId}/secrets/${deployTokenSecret.secretId}/versions/latest`,
};

/** Only apps deploy this way. Referenced so the mapping is stated, not implied. */
export const deployableApps: readonly App[] = APPS;
