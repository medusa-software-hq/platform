import * as neon from '@pulumi/neon';
import type * as pulumi from '@pulumi/pulumi';
import type { AppEnvironmentPair } from './model.ts';
import { neonOrganization } from './organization.ts';

/**
 * Where an app's database lives.
 *
 * Neon runs on other people's clouds, and Frankfurt is the closest it comes to
 * `europe-west1`. A database in a different provider's region is a few milliseconds
 * away, which is the price of a Postgres that suspends itself when nobody is asking.
 */
const NEON_REGION = 'aws-eu-central-1';

/**
 * How far back a database can be rewound: the Free plan's maximum, stated.
 *
 * The provider defaults this to 24 hours, which the Free plan refuses — so a project
 * created without it simply fails to provision. Learned the hard way in an earlier
 * experiment, and written down here so it is not learned again.
 */
const NEON_HISTORY_RETENTION_SECONDS = 21600;

export interface AppEnvNeonResources {
  project: neon.Project;

  /** The app's own key to [project], and to nothing else. */
  apiKey: neon.OrgApiKey;
}

/** An app environment's database: a Neon project, and the app's own key to it. */
export const provisionAppEnvNeonResources = (
  { pair }: { pair: AppEnvironmentPair },
  options: pulumi.CustomResourceOptions,
): AppEnvNeonResources => {
  const { key: name } = pair;

  /**
   * A database for this environment, and nothing said about what goes in it.
   *
   * Creating a Neon project needs organization privilege, which is why it happens
   * here rather than in the app — it is the same act as creating the Google project.
   * What the app does inside it is not this stack's business: the branches,
   * the databases, the roles and the schema are all the app's, reached through the
   * key below.
   *
   * One project per environment rather than one project with a branch per
   * environment, which is Neon's own idiom. Branches share a project's quota and its
   * blast radius; separate projects give staging and production the isolation
   * everything else here already has, and the Free plan allows a hundred of them.
   */
  const project = new neon.Project(
    name,
    {
      name,
      orgId: neonOrganization,
      regionId: NEON_REGION,
      historyRetentionSeconds: NEON_HISTORY_RETENTION_SECONDS,
    },
    options,
  );

  /**
   * The app's own key to that project, and the reason the app can be handed a
   * database rather than a connection string.
   *
   * Scoped to this one project: Neon gives such a key Editor rights on it and
   * nothing anywhere else — it cannot create projects, cannot mint further keys, and
   * cannot see a sibling's. So the same argument as the image registry applies. The
   * app administers what it was given, and this stack never learns what a counter is.
   *
   * One difference from the registry, and it is Neon's rather than a choice made
   * here: a project-scoped key cannot delete its own project. Tearing one down stays
   * this stack's job.
   *
   * Minting it needs more than creating the project did. Neon lets no key mint keys
   * — an organization key is refused, with a 404 that reads like a missing endpoint —
   * and has no service accounts, on any plan. Only a person's key can. So the
   * credential this stack holds is the personal key of a Neon user that exists for
   * nothing else: a member of this organization alone, with the Admin role minting
   * requires. Anyone's own key would have carried every organization they belong to.
   */
  const apiKey = new neon.OrgApiKey(
    name,
    {
      name,
      orgId: neonOrganization,
      projectId: project.id,
    },
    options,
  );

  return { project, apiKey };
};
