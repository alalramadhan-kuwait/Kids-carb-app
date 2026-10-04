import { analysis } from './analysis';
import { core } from './core';
import { food } from './food';
import { settings } from './settings';
import { growth } from './growth';

export const EN: Record<string, string> = { ...core, ...settings, ...food, ...analysis, ...growth };
