import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import { centralProject, centralServices } from './central.ts';

/**
 * The trust that lets an app's stack reach its own project.
 *
 * One pool for every app stack, in central. Apps cannot write here, which is what
 * matters: whoever can add a provider to a pool can mint trust for anything, and
 * whoever can edit a binding can decide who may act as an app.
 */

const config = new pulumi.Config();

/** Pulumi Cloud organization, which is also the audience it issues tokens for. */
export const pulumiOrganization = config.require('pulumiOrganization');

/**
 * The subject Pulumi Cloud puts in tokens issued for an ESC environment. Per
 * environment, unlike the audience, which is the same string across the organization —
 * binding on that would let any app assume any other's account.
 *
 * Duplicated from the bootstrap stack rather than shared, since the two repositories
 * have no code in common. Shape taken from a rejected exchange, not the documentation.
 */
export const escSubject = (project: string, environment: string): string =>
  `pulumi:environments:org:${pulumiOrganization}:env:${project}/${environment}`;

const dependsOn = { dependsOn: centralServices };

export const appPool = new gcp.iam.WorkloadIdentityPool(
  'app-stacks',
  {
    project: centralProject.projectId,
    workloadIdentityPoolId: 'app-stacks',
    displayName: 'App stacks',
    description: 'Identities issued by Pulumi Cloud for app stacks.',
  },
  dependsOn,
);

export const appPoolProvider = new gcp.iam.WorkloadIdentityPoolProvider(
  'app-stacks',
  {
    project: centralProject.projectId,
    workloadIdentityPoolId: appPool.workloadIdentityPoolId,
    workloadIdentityPoolProviderId: 'app-stacks',
    displayName: 'App stacks',

    // Only the subject: every mapped attribute becomes a grantable principal, and one
    // nothing binds to is a principal nobody meant to create.
    attributeMapping: { 'google.subject': 'assertion.sub' },

    oidc: {
      issuerUri: 'https://api.pulumi.com/oidc',
      allowedAudiences: [`gcp:${pulumiOrganization}`],
    },
  },
  dependsOn,
);
