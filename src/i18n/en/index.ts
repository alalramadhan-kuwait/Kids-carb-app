import { analysis } from './analysis';
import { core } from './core';
import { food } from './food';
import { settings } from './settings';
import { growth } from './growth';
import { log } from './log';

export const EN: Record<string, string> = { ...core, ...settings, ...food, ...analysis, ...growth, ...log };
