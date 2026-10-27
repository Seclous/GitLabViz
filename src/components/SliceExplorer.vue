<template>
  <section v-if="explorer.enabled" class="pa-3 border-b" aria-label="Group slice explorer">
    <h2 class="text-subtitle-1">Group slice explorer</h2>
    <div class="d-flex ga-2 flex-wrap align-center my-2">
      <v-select v-model="explorer.mode" :items="modes" label="Browse" hide-details density="compact" style="max-width: 220px" />
      <v-select v-if="explorer.mode === 'scope'" v-model="explorer.value" :items="explorer.scopes" label="Scope value" clearable hide-details density="compact" style="max-width: 420px" />
      <template v-if="explorer.mode === 'issue'">
        <v-text-field v-model="explorer.query" label="Search the full group" hide-details density="compact" style="max-width: 340px" />
        <v-select v-model="explorer.value" :items="issueItems" item-title="title" item-value="id" label="Issue (first 80 matches)" clearable hide-details density="compact" style="max-width: 650px" />
      </template>
    </div>
    <EpicHierarchy v-if="explorer.mode === 'epic'" :hierarchy="hierarchy" :loading="loading" />
    <p v-if="!Object.keys(explorer.slice.nodes).length && !hierarchy.loading" class="text-body-2 my-2">Choose an epic, scope value, or issue to open a slice. Blocked work shows currently indexed active blockers. The full group stays available to search.</p>
    <div v-if="Object.keys(explorer.slice.nodes).length" class="my-2">
      <nav aria-label="Slice breadcrumb" class="text-body-2">{{ source }}
        <template v-if="explorer.breadcrumbs.length"><span v-for="crumb in explorer.breadcrumbs" :key="crumb.id"> / <button v-if="crumb.selectable" class="text-primary" @click="hierarchy.selectedId = crumb.id">{{ crumb.title }}</button><a v-else-if="crumb.url" :href="crumb.url" target="_blank" rel="noopener noreferrer">{{ crumb.title }}</a><span v-else>{{ crumb.title }}</span></span></template>
        <template v-else> / {{ selectionTitle }}</template>
      </nav>
      <p role="status" class="text-caption my-1">{{ explorer.counts.issues }} issues · {{ explorer.counts.projects }} projects · {{ explorer.counts.blocked }} actively blocked · {{ explorer.counts.external }} context issues · {{ Object.keys(explorer.presentation.nodes).length }} shown
        · Dependency coverage: {{ explorer.counts.complete ? 'complete' : 'partial' }} ({{ explorer.counts.fresh }}/{{ explorer.counts.required }} fresh)
        · Updated: {{ explorer.counts.updated ? new Date(explorer.counts.updated).toLocaleString() : 'not indexed' }}</p>
      <div class="d-flex ga-3 flex-wrap align-center my-2">
        <v-select v-model="explorer.hops" :items="[0, 1, 2]" label="Dependency hops" hide-details density="compact" style="max-width: 155px" />
        <v-select v-model="explorer.direction" :items="directions" label="Context direction" hide-details density="compact" style="max-width: 220px" />
        <v-select v-model="explorer.layer" :items="layers" label="Layers" hide-details density="compact" style="max-width: 210px" />
        <v-checkbox v-model="explorer.strict" label="Strict filters" hide-details density="compact" />
        <v-checkbox v-model="explorer.lanes" label="Project lanes" hide-details density="compact" />
        <v-btn size="small" :disabled="explorer.enriching || relationships.running || loading || !explorer.hops" @click="explorer.enrich()">Load dependency context</v-btn>
        <v-btn v-if="explorer.enriching" size="small" @click="explorer.cancel()">Cancel context loading</v-btn>
      </div>
      <p class="text-caption">Facets apply within this slice. Dimmed cards preserve dependency paths unless Strict filters is enabled. Related links are hidden. Counts include indexed context and collapsed descendants.</p>
      <ul v-if="explorer.mode === 'epic' && explorer.tree.length" aria-label="Epic tree" class="epic-tree my-2">
        <li v-for="epic in explorer.tree" :key="epic.id" :style="{ marginLeft: epic.depth * 20 + 'px' }">
          <v-btn size="x-small" variant="text" :aria-expanded="!explorer.collapsed.includes(epic.id)" @click="explorer.toggleCollapse(epic.id)">{{ explorer.collapsed.includes(epic.id) ? 'Expand' : 'Collapse' }}</v-btn>
          <span>{{ epic.title }}</span>
          <span v-if="explorer.presentation.summaries[epic.id]" class="text-caption"> — {{ summaryText(explorer.presentation.summaries[epic.id]) }}</span>
        </li>
      </ul>
      <v-alert v-if="explorer.presentation.omittedNodes || explorer.presentation.omittedEdges" type="warning" density="compact" class="my-2">
        Graph budget reached: {{ explorer.presentation.omittedNodes }} cards and {{ explorer.presentation.omittedEdges }} additional links omitted. Search and counts still use the full slice.
        <v-btn size="small" class="ms-2" @click="explorer.nodeLimit += 100">Show 100 more cards</v-btn>
      </v-alert>
    </div>
  </section>
</template>
<script setup>
import { computed } from 'vue'
import EpicHierarchy from './EpicHierarchy.vue'
const props = defineProps({ explorer: { type: Object, required: true }, hierarchy: { type: Object, required: true }, relationships: { type: Object, required: true }, source: String, loading: Boolean })
const modes = [{ title: 'Browse epics', value: 'epic' }, { title: 'Browse scope values', value: 'scope' }, { title: 'Dependency-blocked work', value: 'blocked' }, { title: 'Search issue', value: 'issue' }]
const directions = [{ title: 'Upstream blockers', value: 'upstream' }, { title: 'Downstream dependents', value: 'downstream' }, { title: 'Both directions', value: 'both' }]
const layers = [{ title: 'Hierarchy + dependencies', value: 'both' }, { title: 'Hierarchy', value: 'hierarchy' }, { title: 'Dependencies', value: 'dependencies' }]
const issueItems = computed(() => props.explorer.searchResults.map(n => ({ id: n.id, title: (n.fullReference || n.iid) + ' ' + n._raw.title })))
const selectionTitle = computed(() => props.explorer.mode === 'epic' ? props.hierarchy.epics.find(e => e.id === props.hierarchy.selectedId)?.title || 'Epic' : props.explorer.mode === 'blocked' ? 'Dependency-blocked work' : props.explorer.mode === 'issue' ? issueItems.value.find(n => n.id === props.explorer.value)?.title || props.explorer.value : 'scope::' + props.explorer.value)
const summaryText = s => s.total + ' issues · ' + s.open + ' open · ' + s.closed + ' closed · ' + s.projects + ' projects · ' + s.blocked + ' blocked'
</script>
<style scoped>.epic-tree { list-style: none; padding: 0; max-height: 220px; overflow: auto; }</style>
