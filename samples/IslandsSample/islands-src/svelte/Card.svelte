<!-- A Svelte 5 component as an island. Compiled with css: 'external', so its scoped style goes to svelte-bundle.css and is
     linked inside the shadow root through <Island Styles> (an injected <style> would be blocked by style-src 'self'). -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getIsland } from '@blazor-islands/client/svelte';
  import type { CardProps } from '../generated/types';
  import { lifecycle } from '../lifecycle';

  let { framework, title, start, items }: CardProps = $props();
  const island = getIsland<CardProps>();
  // Local state: kept when the server sends new props.
  // svelte-ignore state_referenced_locally
  let count = $state(start);

  onMount(() => {
    lifecycle('svelte').mounts++;
  });
  onDestroy(() => {
    lifecycle('svelte').unmounts++;
  });

  const emitClick = () => island.emit('card-click', { framework: 'svelte', count });
</script>

<div class="card">
  <h3 data-testid="title">{title}</h3>
  <p data-testid="framework">{framework}</p>
  <button type="button" data-testid="increment" onclick={() => count++}>+1</button>
  <output data-testid="count">{count}</output>
  <ul data-testid="items">
    {#each items as item (item)}
      <li>{item}</li>
    {/each}
  </ul>
  <button type="button" data-testid="emit" onclick={emitClick}>Emit</button>
</div>

<style>
  .card {
    border-left: 4px solid rgb(255, 62, 0);
    padding: 0.5rem 1rem;
  }
</style>
