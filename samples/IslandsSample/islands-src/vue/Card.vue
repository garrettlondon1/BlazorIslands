<!-- A Vue single-file component as an island. Compiled ahead of time by unplugin-vue, so the page needs only Vue's
     runtime-only build (no template compiler, no 'unsafe-eval'). Its scoped style is extracted to vue-bundle.css and
     linked inside the island's shadow root through <Island Styles>. -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useIsland } from '@blazor-islands/client/vue';
import type { CardProps } from '../generated/types';
import { lifecycle } from '../lifecycle';

const props = defineProps<CardProps>();
const island = useIsland<CardProps>();
// Local state: kept when the server sends new props (enhanced navigation, streaming, interactive re-render).
const count = ref(props.start);

onMounted(() => lifecycle('vue').mounts++);
onUnmounted(() => lifecycle('vue').unmounts++);

const emitClick = () => island.emit('card-click', { framework: 'vue', count: count.value });
</script>

<template>
  <div class="card">
    <h3 data-testid="title">{{ props.title }}</h3>
    <p data-testid="framework">{{ props.framework }}</p>
    <button type="button" data-testid="increment" @click="count++">+1</button>
    <output data-testid="count">{{ count }}</output>
    <ul data-testid="items">
      <li v-for="item in props.items" :key="item">{{ item }}</li>
    </ul>
    <button type="button" data-testid="emit" @click="emitClick">Emit</button>
  </div>
</template>

<style scoped>
.card {
  border-left: 4px solid rgb(66, 184, 131);
  padding: 0.5rem 1rem;
}
</style>
