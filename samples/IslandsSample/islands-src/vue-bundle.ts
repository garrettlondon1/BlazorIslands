// Vue islands. Vue is bundled here (runtime-only build) and shared by every Vue island on the page.
import { vueIslands } from '@blazor-islands/client/vue';
import Card from './vue/Card.vue';

export const islands = vueIslands({ Card });
