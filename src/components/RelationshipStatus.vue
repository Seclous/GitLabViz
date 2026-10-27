<template>
  <div v-if="config.enableGitLab && primary.length" class="px-3 py-2 border-b bg-surface text-body-2" role="region" aria-label="Issue relationships">
    <div class="d-flex align-center flex-wrap ga-2">
      <strong>Relationships</strong>
      <span>{{ indexedCount }} / {{ primary.length }} issues indexed · {{ freshCount }} fresh</span>
      <span>· {{ summary.blocked.size }} dependency-blocked · {{ summary.unknown.size }} unknown state</span>
      <v-btn size="small" variant="tonal" :disabled="running || loading" @click="scan()">Scan visible</v-btn>
      <v-btn size="small" variant="text" :disabled="running || loading" @click="scan({ force: true })">Refresh visible links</v-btn>
      <v-btn v-if="config.gitlabSourceKind === 'group'" size="small" variant="text" :disabled="running || loading" @click="scan({ full: true, force: true })">Scan full group links</v-btn>
      <v-btn v-if="running" size="small" color="warning" @click="cancel">Cancel link scan</v-btn>
      <v-btn v-if="Object.keys(errors).length" size="small" :disabled="running || loading" @click="scan({ full: true, retry: true })">Retry {{ Object.keys(errors).length }} failed</v-btn>
    </div>
    <div class="text-caption" role="status" aria-live="polite">
      {{ running ? 'Indexing links: ' + completed + ' / ' + total : message }}
      <span v-if="cacheWarning"> {{ cacheWarning }}</span>
      <span v-if="indexedCount < primary.length"> Coverage is partial; unindexed issues may have dependencies.</span>
      <span v-if="indexedCount > freshCount"> Some links are stale; refresh to verify.</span>
      <span v-if="diagnostics.missing"> {{ diagnostics.missing }} missing/inaccessible endpoints.</span>
      <span v-if="diagnostics.externalOmitted"> {{ diagnostics.externalOmitted }} external endpoints omitted by budget.</span>
      <span v-if="diagnostics.edgesOmitted"> {{ diagnostics.edgesOmitted }} links omitted by budget.</span>
      <span v-if="diagnostics.unsupported"> {{ diagnostics.unsupported }} unsupported link types.</span>
      <span v-if="Object.keys(errors).length"> {{ Object.keys(errors).length }} unavailable issues ({{ [...new Set(Object.values(errors))].join(', ') }}).</span>
    </div>
  </div>
</template>
<script setup>
import { toRefs } from 'vue'
const props = defineProps({ config: Object, relationships: Object, loading: Boolean })
const { running, completed, total, errors, message, cacheWarning, diagnostics, summary, indexedCount, freshCount, primary, scan, cancel } = toRefs(props.relationships)
</script>
