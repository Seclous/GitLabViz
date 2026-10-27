import { describe, it, expect } from 'vitest'
import { scopeValues, dependencyClosure, selectSlice, presentSlice } from './groupSlices'
const issue = (id, project = 1, state = 'opened', labels = []) => ({ id, type: 'gitlab_issue', projectId: project, state, _raw: { title: id, labels } })
const edge = (source, target, label = 'blocks') => ({ source, target, label, kind: 'issue_link' })
const contains = (source, target) => ({ source, target, label: 'contains', kind: 'contains' })
const keys = o => Object.keys(o).sort()
describe('group slices', () => {
  it('selects scope labels across projects without changing the full index', () => {
    const nodes = { a: issue('a', 1, 'opened', ['Scope::API']), b: issue('b', 2, 'opened', ['scope::API']), c: issue('c') }
    expect(scopeValues(nodes)).toEqual(['API'])
    const slice = selectSlice({ mode: 'scope', value: 'api', nodes, edges: {}, hops: 0 })
    expect(keys(slice.nodes)).toEqual(['a', 'b']); expect(keys(nodes)).toEqual(['a', 'b', 'c'])
  })
  it('walks directional dependencies for at most two hops and tolerates cycles', () => {
    const nodes = Object.fromEntries(['a','b','c','d'].map(id => [id, issue(id)]))
    const edges = { ab: edge('a','b'), bc: edge('b','c'), cd: edge('c','d'), ca: edge('c','a'), related: edge('d','a','relates') }
    expect([...dependencyClosure(['c'], nodes, edges, { hops: 0 })]).toEqual(['c'])
    expect([...dependencyClosure(['c'], nodes, edges, { hops: 1 })].sort()).toEqual(['b','c'])
    expect([...dependencyClosure(['c'], nodes, edges, { hops: 2 })].sort()).toEqual(['a','b','c'])
    expect([...dependencyClosure(['a'], nodes, edges, { hops: 2, direction: 'downstream' })].sort()).toEqual(['a','b','c'])
    expect([...dependencyClosure(['c'], nodes, edges, { hops: 1, direction: 'both' })].sort()).toEqual(['a','b','c','d'])
  })
  it('preserves a hidden blocker path as read-only dimmed context unless strict', () => {
    const nodes = { a: issue('a'), b: issue('b'), c: issue('c') }, edges = { ab: edge('a','b'), bc: edge('b','c') }
    const slice = selectSlice({ mode: 'issue', value: 'c', nodes, edges, hops: 2 })
    const normal = presentSlice(slice, { c: nodes.c }, { hops: 2 })
    expect(keys(normal.nodes)).toEqual(['a','b','c']); expect(normal.nodes.b).toMatchObject({ sliceContext: true, hierarchyReadOnly: true })
    expect(keys(presentSlice(slice, { c: nodes.c, unrelated: issue('unrelated') }, { hops: 2, strict: true }).nodes)).toEqual(['c'])
    expect(presentSlice(slice, {}, { hops: 2 }).nodes).toEqual({})
    expect(nodes.b.sliceContext).toBeUndefined()
  })
  it('collapses epic descendants into aggregate cards and redirects dependencies', () => {
    const nodes = { a: issue('a',1), b: issue('b',2,'closed'), x: issue('x',3) }
    const hierarchyNodes = { e: { id:'e', type:'gitlab_epic', _raw:{title:'Epic'} }, a:nodes.a, b:nodes.b }
    const hierarchyEdges = { ea:contains('e','a'), eb:contains('e','b') }
    const slice = selectSlice({ mode:'epic', value:'e', nodes, edges:{ xa:edge('x','a') }, hierarchyNodes, hierarchyEdges })
    const view = presentSlice(slice, slice.nodes, { collapsed:['e'] })
    expect(keys(view.nodes)).toEqual(['e','x'])
    expect(view.summaries.e).toEqual({ total:2, open:1, closed:1, projects:2, blocked:1 })
    expect(Object.values(view.edges)).toMatchObject([{source:'x', target:'e', label:'blocks'}])
    expect(keys(slice.nodes)).toEqual(['a','b','e','x'])
  })
  it('keeps hierarchy and dependency layers distinct and hides related links', () => {
    const slice = { nodes:{e:{id:'e',type:'gitlab_epic',_raw:{title:'Epic'}},a:issue('a'),b:issue('b')}, seeds:['e','a','b'], blocked:new Set(), edges:{ea:contains('e','a'),ab:edge('a','b'),ba:edge('b','a','relates')} }
    expect(Object.values(presentSlice(slice,slice.nodes,{layer:'hierarchy'}).edges).map(e=>e.kind)).toEqual(['contains'])
    expect(Object.values(presentSlice(slice,slice.nodes,{layer:'dependencies'}).edges).map(e=>e.label)).toEqual(['blocks'])
    expect(Object.values(presentSlice(slice,slice.nodes).edges)).toHaveLength(2)
  })
  it('bounds graph rendering without dropping the underlying slice or creating dangling edges', () => {
    const nodes = Object.fromEntries(Array.from({length:205},(_,i)=>[String(i),issue(String(i))]))
    const edges = Object.fromEntries(Array.from({length:204},(_,i)=>[String(i),edge(String(i),String(i+1))]))
    const slice = { nodes, edges, seeds:keys(nodes), blocked:new Set() }
    const view = presentSlice(slice,nodes,{nodeLimit:200,edgeLimit:2})
    expect(keys(view.nodes)).toHaveLength(200); expect(view.omittedNodes).toBe(5); expect(keys(view.edges)).toHaveLength(2); expect(view.omittedEdges).toBeGreaterThan(0)
    expect(Object.values(view.edges).every(e=>view.nodes[e.source]&&view.nodes[e.target])).toBe(true)
    expect(keys(presentSlice(slice,nodes,{nodeLimit:300}).nodes)).toHaveLength(205)
  })
  it('blocked work excludes closed blockers and external seeds', () => {
    const nodes = { a:issue('a'),b:issue('b'),c:issue('c',1,'closed'),d:issue('d'),x:{...issue('x'),externalContext:true} }
    const slice = selectSlice({mode:'blocked',nodes,edges:{ab:edge('a','b'),cd:edge('c','d'),ax:edge('a','x')},hops:0})
    expect(slice.seeds).toEqual(['b'])
  })
})
