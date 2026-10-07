// Svelte islands. The Svelte runtime is bundled here and shared by every Svelte island on the page.
import { svelteIslands } from '@blazor-islands/client/svelte';
import Card from './svelte/Card.svelte';

export const islands = svelteIslands({ Card });
