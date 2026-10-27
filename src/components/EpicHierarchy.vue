<template>
  <div v-if="hierarchy.enabled" class="px-3 py-2 border-b" aria-label="Epic hierarchy">
    <div class="d-flex align-center ga-2 flex-wrap">
      <v-btn size="small" variant="tonal" :disabled="hierarchy.loading || loading" @click="hierarchy.refresh()">{{ hierarchy.indexReady ? 'Refresh epics' : 'Load epics' }}</v-btn>
      <v-select v-if="hierarchy.indexReady" v-model="hierarchy.selectedId" :items="items" item-title="title" item-value="id"
        label="Epic (all descendants)" clearable hide-details density="compact" variant="outlined" style="max-width: 650px; min-width: 260px"
        :disabled="hierarchy.loading || loading" />
      <v-checkbox v-if="hierarchy.selectedId" v-model="hierarchy.includeTasks" label="Include tasks" hide-details density="compact"
        :disabled="hierarchy.loading || loading || hierarchy.mode === 'legacy'" />
      <span v-if="hierarchy.status && !hierarchy.loading" role="status" class="text-caption">{{ hierarchy.status }}</span>
      <span v-if="hierarchy.loading" role="status" class="text-caption">Loading epic hierarchy…</span>
      <v-btn v-if="hierarchy.loading" size="small" variant="text" @click="hierarchy.cancel()">Cancel epics</v-btn>
      <span v-if="hierarchy.indexReady && !hierarchy.epics.length" class="text-caption">No accessible epics returned by GitLab.</span>
      <span v-if="hierarchy.selectedId && !hierarchy.loading" class="text-caption">{{ issues }} issues / tasks · {{ epics }} epics · {{ external }} external to group. Existing filters apply.</span>
    </div>
    <div v-if="hierarchy.error" role="alert" class="text-error text-caption">{{ hierarchy.error }} <v-btn size="x-small" @click="hierarchy.retry()">Retry epics</v-btn></div>
    <div v-for="warning in hierarchy.warnings" :key="warning" role="status" class="text-warning text-caption">{{ warning }}</div>
    <div v-if="hierarchy.selectedId" class="text-caption text-medium-emphasis">The list shows issues and tasks. The graph also shows epics and optional containment links. External to group items are read-only.</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { relativeToGroup } from '../utils/relativeToGroup'
const props = defineProps({ hierarchy: { type: Object, required: true }, loading: Boolean })
const items = computed(() => props.hierarchy.epics.map(e => ({ id: e.id, title: `${relativeToGroup(e.namespacePath, props.hierarchy.fullPath)}&${e.iid} · ${e.title}` })))
const values = computed(() => Object.values(props.hierarchy.hierarchyNodes))
const issues = computed(() => values.value.filter(n => n.type === 'gitlab_issue').length)
const epics = computed(() => values.value.filter(n => n.type === 'gitlab_epic').length)
const external = computed(() => values.value.filter(n => n.externalToGroup).length)
</script>
