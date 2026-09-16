import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import { delegationFolder, pulumiOrganization } from './config.ts';
import type { Environment } from './model.ts';
import { billingAccount, githubOrganization, organizationAdmins } from './organization.ts';
import type { PlatformCloudflareResources } from './platform-cloudflare.ts';

/**
 * What exists in Google Cloud once for the whole platform, whatever the app: the folder tree, the
 * central project, the identity pools apps and their workflows federate through, and the deploy
 * workflow's credentials.
 */

/**
 * Adoption identifiers for folders that predate this program go here, keyed by
 * resource name, and are removed once an `up` has taken them. Empty means the tree is
 * fully owned.
 */
const ADOPT: Readonly<Record<string, string>> = {};

const adopt = (name: string): pulumi.CustomResourceOptions => {
  const id = ADOPT[name];
  return id === undefined ? {} : { import: id };
};

/** A folder, adopted instead of created when [ADOPT] names it. */
export const adoptableFolder = (
  name: string,
  displayName: string,
  parent: pulumi.Input<string>,
  options: pulumi.CustomResourceOptions = {},
): gcp.organizations.Folder =>
  new gcp.organizations.Folder(name, { displayName, parent }, { ...options, ...adopt(name) });

/**
 * Operations a deployment of an app stack may authenticate for.
 *
 * `destroy` is absent: GCP matches subjects exactly and allows no wildcard, so an
 * operation with no binding cannot obtain a credential at all. Removing a resource from
 * a program is an `update` and still works; discarding a whole environment does not.
 */
export const DEPLOY_OPERATIONS = ['preview', 'update', 'refresh'] as const;

/** The subject Pulumi Cloud puts in tokens issued for a deployment, one per operation. */
export const deploySubject = (app: string, stack: string, operation: string): string =>
  `pulumi:deploy:org:${pulumiOrganization}:project:${app}:stack:${stack}:operation:${operation}:scope:write`;

/**
 * Where an app's deploy workflow must live, and the ref it must run from.
 *
 * Appended to whichever repository asked, rather than naming one repository — so every app
 * deploys itself with a file it owns, and the condition still admits nothing but that file.
 *
 * The steps have to be in that file itself. `job_workflow_ref` names the workflow that *defines*
 * the running job, so a job delegating to another workflow of the app's own would assert that
 * one's path instead and be refused.
 */
const DEPLOY_WORKFLOW_PATH = '/.github/workflows/deploy.yml@refs/heads/main';

/** The one branch a caller may run it from. */
const CALLER_REF = 'refs/heads/main';

/** What an app's workflow needs in order to ask for the deploy identity. */
export interface DeployIdentity {
  provider: pulumi.Output<string>;
  serviceAccount: pulumi.Output<string>;
  secret: pulumi.Output<string>;
  smokeTestSecret: pulumi.Output<string>;
}

export interface PlatformGcpResources {
  /** The one project that belongs to no app. */
  readonly centralProject: gcp.organizations.Project;

  /** The APIs central has on, which anything created in central waits for. */
  readonly centralServices: gcp.projects.Service[];

  /** Where each environment's app folders go. */
  readonly appsFolders: Readonly<Record<Environment, gcp.organizations.Folder>>;

  /** The pool app stacks' deployments federate through. */
  readonly appStacksPool: gcp.iam.WorkloadIdentityPool;
  readonly appStacksPoolProvider: gcp.iam.WorkloadIdentityPoolProvider;

  /** The pool GitHub Actions push images through. */
  readonly githubActionsPool: gcp.iam.WorkloadIdentityPool;
  readonly githubActionsPoolProvider: gcp.iam.WorkloadIdentityPoolProvider;

  /** The pool and the account the deploy workflow reads the Pulumi token through. */
  readonly deployPool: gcp.iam.WorkloadIdentityPool;
  readonly deployServiceAccount: gcp.serviceaccount.Account;

  /** What an app's deploy workflow is told, to ask for that identity. */
  readonly deployIdentity: DeployIdentity;
}

/**
 * The platform's Google Cloud: the folder tree, central, the pools and the deploy credentials.
 *
 * Takes the Access smoke-test token, whose secret the deploy workflow reads from central.
 */
export const provisionPlatformGcpResources = ({
  cloudflare,
}: {
  cloudflare: PlatformCloudflareResources;
}): PlatformGcpResources => {
  /**
   * The folder hierarchy.
   *
   *   <delegation folder>/
   *   ├── shared/                      the central project
   *   └── environments/
   *       ├── production/apps/<app>/
   *       └── staging/apps/<app>/
   *
   * Environment-major on purpose. A single `production` folder means a new app cannot
   * land in production without inheriting whatever policy sits there — inheritance is
   * fail-closed this way round. App-major would make per-app delegation one grant
   * instead of two, at the cost of an app nobody remembered to stamp inheriting nothing.
   */

  /** Holds the central project: shared state and registries, nothing app-specific. */
  const sharedFolder = adoptableFolder('shared', 'shared', delegationFolder);

  const environmentsFolder = adoptableFolder('environments', 'environments', delegationFolder);

  /**
   * An environment's folder, and the `apps` folder inside it, which is where app folders go. Room
   * is left beside `apps` for anything that is environment-scoped but not an app.
   */
  const environmentAppsFolder = (environment: Environment): gcp.organizations.Folder => {
    const environmentFolder = adoptableFolder(environment, environment, environmentsFolder.name);

    return adoptableFolder(`${environment}-apps`, 'apps', environmentFolder.name);
  };

  /** Written out rather than iterated, and typed so an environment added to the model is missed loudly. */
  const appsFolders: Readonly<Record<Environment, gcp.organizations.Folder>> = {
    production: environmentAppsFolder('production'),
    staging: environmentAppsFolder('staging'),
  };

  /**
   * The one project that belongs to no app.
   *
   * It holds what apps need but must not own: the accounts they deploy with, and later
   * the registry their images are promoted through. Keeping those here rather than in an
   * app's own project is the point — an app holds broad rights inside its project, so
   * anything kept alongside is something it could rewrite.
   */
  const suffix = new random.RandomId('central-project-suffix', { byteLength: 4 });

  const centralProject = new gcp.organizations.Project('central', {
    name: 'central',
    projectId: suffix.hex.apply((hex) => `ms-central-${hex}`),
    folderId: sharedFolder.folderId,
    billingAccount: billingAccount.id,

    // Exploration phase: `destroy` should actually destroy.
    deletionPolicy: 'DELETE',
  });

  const centralServices = [
    // Read by Cloudflare Access, through the OAuth client kept here, for the groups a
    // Google Workspace account belongs to.
    'admin.googleapis.com',
    'artifactregistry.googleapis.com',
    'cloudresourcemanager.googleapis.com',
    'iam.googleapis.com',
    'iamcredentials.googleapis.com',
    'secretmanager.googleapis.com',
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

  const dependsOn = { dependsOn: centralServices };

  /**
   * The trust that lets an app's stack reach its own project.
   *
   * One pool for every app stack, in central. Apps cannot write here, which is what
   * matters: whoever can add a provider to a pool can mint trust for anything, and
   * whoever can edit a binding can decide who may act as an app.
   */
  const appStacksPool = new gcp.iam.WorkloadIdentityPool(
    'app-stacks',
    {
      project: centralProject.projectId,
      workloadIdentityPoolId: 'app-stacks',
      displayName: 'App stacks',
      description: 'Identities issued by Pulumi Cloud for app stacks.',
    },
    dependsOn,
  );

  const appStacksPoolProvider = new gcp.iam.WorkloadIdentityPoolProvider(
    'app-stacks',
    {
      project: centralProject.projectId,
      workloadIdentityPoolId: appStacksPool.workloadIdentityPoolId,
      workloadIdentityPoolProviderId: 'app-stacks',
      displayName: 'App stacks',

      // Only the subject: every mapped attribute becomes a grantable principal, and one
      // nothing binds to is a principal nobody meant to create.
      attributeMapping: { 'google.subject': 'assertion.sub' },

      oidc: {
        issuerUri: 'https://api.pulumi.com/oidc',
        // Two forms, because ESC and Deployments issue under different audiences for
        // the same organization: `gcp:<org>` when an environment opens a login, and the
        // bare organization name when a deployment mints its own credentials. Accepting
        // only the first is accepting only the half of this that had been exercised —
        // an app's stack never touched Google Cloud until it deployed a service, and
        // then failed with an audience mismatch. The bootstrap stack learned this for
        // its own pool and it did not travel.
        allowedAudiences: [`gcp:${pulumiOrganization}`, pulumiOrganization],
      },
    },
    dependsOn,
  );

  /**
   * A separate pool from the one app stacks use. Different issuer, different trust —
   * and keeping them apart means a token minted for one can never satisfy the other.
   */
  const githubActionsPool = new gcp.iam.WorkloadIdentityPool(
    'github-actions',
    {
      project: centralProject.projectId,
      workloadIdentityPoolId: 'github-actions',
      displayName: 'GitHub Actions',
      description: 'Identities issued by GitHub Actions for repositories in this organization.',
    },
    dependsOn,
  );

  const githubActionsPoolProvider = new gcp.iam.WorkloadIdentityPoolProvider(
    'github-actions',
    {
      project: centralProject.projectId,
      workloadIdentityPoolId: githubActionsPool.workloadIdentityPoolId,
      workloadIdentityPoolProviderId: 'github-actions',
      displayName: 'GitHub Actions',

      attributeMapping: {
        'google.subject': 'assertion.sub',
        // Bound to per app. Nothing maps the owner or the visibility: those would be
        // grantable principals covering every repository at once.
        'attribute.repository': 'assertion.repository',
      },

      attributeCondition: `assertion.repository_owner == '${githubOrganization}'`,

      oidc: { issuerUri: 'https://token.actions.githubusercontent.com' },
    },
    dependsOn,
  );

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

  /**
   * A pool of its own, not the one images are pushed from.
   *
   * The same reasoning that separated that one: an identity minted for pushing an image
   * must not also satisfy this, and the surest way to guarantee that is for the two to
   * share no namespace. This pool admits far less than that one does.
   */
  const deployPool = new gcp.iam.WorkloadIdentityPool(
    'github-deploy',
    {
      project: centralProject.projectId,
      workloadIdentityPoolId: 'github-deploy',
      displayName: 'GitHub Actions deployments',
      description: 'Identities issued to the deploy workflow, and to nothing else.',
    },
    dependsOn,
  );

  const deployPoolProvider = new gcp.iam.WorkloadIdentityPoolProvider(
    'github-deploy',
    {
      project: centralProject.projectId,
      workloadIdentityPoolId: deployPool.workloadIdentityPoolId,
      workloadIdentityPoolProviderId: 'github-deploy',
      displayName: 'GitHub Actions deployments',

      attributeMapping: {
        'google.subject': 'assertion.sub',
        // Which repository asked. Bound per app, so an app's identity is its own.
        'attribute.repository': 'assertion.repository',
      },

      /**
       * Three claims, because one is not enough.
       *
       * `job_workflow_ref` is compared against a path built from the repository that asked, so
       * an app deploys itself with a file it owns at a path this stack fixes, and nothing else
       * in that repository can reach the credential. The other two describe the caller:
       * `repository_owner` because these repositories are public and anyone at all may call a
       * public workflow, and `ref` because a deployment should come from a merge rather than
       * from a branch or a fork.
       *
       * What this deliberately stopped doing is deciding what the steps are. An app that can
       * read the Pulumi token can do whatever that token permits — which is the trade: the
       * sequence becomes the app's to shape, and the credential stops being out of its reach.
       */
      attributeCondition: [
        `assertion.repository_owner == '${githubOrganization}'`,
        `assertion.ref == '${CALLER_REF}'`,
        `assertion.job_workflow_ref == assertion.repository + '${DEPLOY_WORKFLOW_PATH}'`,
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
  const deployTokenSecret = new gcp.secretmanager.Secret(
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
  const deployServiceAccount = new gcp.serviceaccount.Account(
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
  const secretKeeper = organizationAdmins;

  new gcp.secretmanager.SecretIamMember('pulumi-deploy-token-keeper', {
    project: centralProject.projectId,
    secretId: deployTokenSecret.secretId,
    role: 'roles/secretmanager.secretVersionAdder',
    member: secretKeeper,
  });

  new gcp.secretmanager.SecretIamMember('pulumi-deploy-token-accessor', {
    project: centralProject.projectId,
    secretId: deployTokenSecret.secretId,
    role: 'roles/secretmanager.secretAccessor',
    member: deployServiceAccount.member,
  });

  /**
   * The token the smoke test gets past the sign-in with, kept beside the Pulumi one.
   *
   * Unlike that one, its value is managed here: this stack created the token, so its secret is in
   * this stack's state already, and a person copying it across would only be a second place for it
   * to go wrong. Read by the same account and nothing else.
   */
  const smokeTestTokenSecret = new gcp.secretmanager.Secret(
    'access-smoke-test-token',
    {
      project: centralProject.projectId,
      secretId: 'access-smoke-test-token',
      replication: { auto: {} },
    },
    dependsOn,
  );

  new gcp.secretmanager.SecretVersion('access-smoke-test-token', {
    secret: smokeTestTokenSecret.id,
    secretData: pulumi.secret(
      pulumi.jsonStringify({
        clientId: cloudflare.smokeTestToken.clientId,
        clientSecret: cloudflare.smokeTestToken.clientSecret,
      }),
    ),
  });

  new gcp.secretmanager.SecretIamMember('access-smoke-test-token-accessor', {
    project: centralProject.projectId,
    secretId: smokeTestTokenSecret.secretId,
    role: 'roles/secretmanager.secretAccessor',
    member: deployServiceAccount.member,
  });

  return {
    centralProject,
    centralServices,
    appsFolders,
    appStacksPool,
    appStacksPoolProvider,
    githubActionsPool,
    githubActionsPoolProvider,
    deployPool,
    deployServiceAccount,
    deployIdentity: {
      provider: deployPoolProvider.name,
      serviceAccount: deployServiceAccount.email,
      secret: pulumi.interpolate`projects/${centralProject.projectId}/secrets/${deployTokenSecret.secretId}/versions/latest`,
      smokeTestSecret: pulumi.interpolate`projects/${centralProject.projectId}/secrets/${smokeTestTokenSecret.secretId}/versions/latest`,
    },
  };
};
