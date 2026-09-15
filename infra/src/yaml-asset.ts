import * as pulumi from '@pulumi/pulumi';
import { stringify } from 'yaml';

/**
 * [document] as a YAML asset, once every Output anywhere inside it has resolved.
 *
 * `pulumi.output` unwraps Outputs nested at any depth of a plain object or array, so a document
 * is written as the data it is — keys and values side by side — rather than as a template with
 * a positional list of values to fill it. A secret anywhere inside keeps the whole asset secret.
 *
 * Long strings are never folded onto several lines: the text is compared as text, and a value
 * that reads the same should not be spelled two ways depending on how long it happens to be.
 */
export const yamlAsset = (document: object): pulumi.Output<pulumi.asset.StringAsset> =>
  pulumi
    .output(document)
    .apply((resolved) => new pulumi.asset.StringAsset(stringify(resolved, { lineWidth: 0 })));
