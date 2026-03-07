import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export const getEnv = (varName: string) => {
  const val = process.env[varName];
  if (!val) {
    throw new Error(`${varName} is empty`);
  }
  return val!;
};

export function getHashCode(max: number): number {
  return Math.floor(Math.random() * max);
}

// Service base ranges to prevent cross-service priority collisions
const SERVICE_BASE: Record<string, number> = {
  rproxy:     1000,
  orders:     10000,
  products:   20000,
  users:      30000,
  fossaadmin: 40000,
  fossacore:  45000,
};

export function getRulePriority(tenantId: string, serviceName: string): number {
  const base = SERVICE_BASE[serviceName] ?? 1000;
  let hash = 0;
  for (let i = 0; i < tenantId.length; i++) {
    hash = (hash * 31 + tenantId.charCodeAt(i)) >>> 0;
  }
  // Up to 4999 tenants per service slot before collision
  return base + (hash % 4999) + 1;
}


const getTimeString = () => {
  const date = new Date();
  const yyyy = date.getFullYear().toString();
  const MM = pad(date.getMonth() + 1, 2);
  const dd = pad(date.getDate(), 2);
  const hh = pad(date.getHours(), 2);
  const mm = pad(date.getMinutes(), 2);
  const ss = pad(date.getSeconds(), 2);
  return yyyy + MM + dd + hh + mm + ss;
};

const pad = (n: number, l: number) => {
  let str = '' + n;
  while (str.length < l) {
    str = '0' + str;
  }
  return str;
};

export default getTimeString;

export const addTemplateTag = (construct: Construct, tag: string) => {
  const stackDesc = Stack.of(construct).templateOptions.description;
  const baseTelemetry = 'saas-reference-architecture-ecs (uksb-bwv1p0slbs)';
  let description = stackDesc;
  // There is no description, just make it telemetry + tags
  if (stackDesc === undefined) {
    description = appendTagToDescription(baseTelemetry, tag);
  }
  // There is a description, and it doesn't contain telemetry. We need to append telemetry + tags to it
  else if (!stackDesc.includes(baseTelemetry)) {
    description = appendTagToDescription(`${stackDesc} - ${baseTelemetry}`, tag);
  }
  // There is a telemetry description already
  else {
    description = appendTagToDescription(stackDesc, tag);
  }
  Stack.of(construct).templateOptions.description = description;
};

const appendTagToDescription = (existingDescription: string, newTag: string): string => {
  // Check if the existing description already has tags
  if (existingDescription.includes('(tag:')) {
    // Extract the existing tags
    const startIndex = existingDescription.indexOf('(tag:') + 6;
    const endIndex = existingDescription.lastIndexOf(')');
    const existingTags = existingDescription.substring(startIndex, endIndex).split(', ');

    // Check if the new tag already exists
    if (!existingTags.includes(newTag)) {
      // Append the new tag to the existing tags
      existingTags.push(newTag);
      const newDescription = `${existingDescription.substring(0, startIndex)}${existingTags.join(', ')})`;
      return newDescription;
    } else {
      // The new tag already exists, return the original description
      return existingDescription;
    }
  } else {
    // Append the new tag to the description
    return `${existingDescription} (tag: ${newTag})`;
  }
};
