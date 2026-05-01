# Planetary Interaction Implementation Plan

This plan tracks implementation of EVE Planetary Interaction, also known as PI. The immediate client crash is caused by `planetMgr` not handling moniker resolution, but the full feature spans planet view data, persistent colonies, resource simulation, production, inventory, customs offices, and notifications.

Alpha clone limits are not a gameplay goal for this server. Only implement those checks if the client explicitly requires a server response to keep the UI stable.

## Progress Snapshot

- Phase 0 complete: planet moniker binding, basic planet info, persistent resource qualities, safe empty read-only calls.
- Phase 1 static authority complete: `planetSchematics` table, PI structure/resource/commodity classification, key dogma attribute helpers, command-center upgrade constants, and hardcoded planet-type resource map.
- Phase 2 basic colony editing complete: `UserUpdateNetwork` accepts all client command stream IDs, remaps temporary pin/route IDs, persists colony pins/links/routes, returns client-shaped colony rows, supports `UserAbandonPlanet`, and consumes the placed command center item from ship inventory when present.
- Phase 3 server-native resource layers complete: each visited planet/resource gets persistent deterministic hotspots, ECU program estimates use the layer values and client-style head overlap, installed ECU programs write depletion events that affect later estimates, and `GetResourceData(info)` now returns experimental deterministic heatmap bytes.
- Still open from Phase 3: validate the experimental heatmap bytes against the V23 client. If the client rejects them or renders nonsense, we need the proprietary `PlanetResources.builder.CreateSHFromBuffer` buffer details or a live non-null payload capture.
- Still open from Phase 2: authoritative server-side validation, non-command-center placement costs, strict inventory ownership checks, CPU/power/link bandwidth enforcement, and real PI simulation remain later-phase work.

## Client Surface

The client enters PI through `eveMoniker.GetPlanet(planetID)`, which creates a `planetMgr` moniker. That means the server must support `MachoResolveObject` and `MachoBindObject` before normal planet calls are made.

The main bound `planetMgr` calls are:

- `GetPlanetInfo()`
- `GetPlanetResourceInfo()`
- `GetResourceData(info)`
- `GetFullNetworkForOwner(planetID, characterID)`
- `GetCommandPinsForPlanet(planetID)`
- `GetExtractorsForPlanet(planetID)`
- `UserUpdateNetwork(serializedChanges)`
- `UserAbandonPlanet()`
- `UserLaunchCommodities(commandPinID, commoditiesToLaunch)`
- `UserTransferCommodities(path, commodities)`
- `GetProgramResultInfo(pinID, typeID, heads, headRadius)`

Related services and calls:

- `planetMgr.GetPlanetsForChar()`
- `planetMgr.GetMyLaunchesDetails()`
- `planetMgr.DeleteLaunch(launchID)`
- `planetOrbitalRegistryBroker.GetTaxRate(customsOfficeID)`
- inventory bound object `ImportExportWithPlanet(spaceportPinID, importData, exportData, taxRate)`

## Persistent Data Model

Use a dedicated runtime table, initially `planetRuntimeState`, so PI state survives server restarts and can be iterated without modifying character records directly.

Initial shape:

```json
{
  "schemaVersion": 1,
  "resourcesByPlanetID": {},
  "coloniesByKey": {},
  "launchesByID": {},
  "nextIDs": {
    "pinID": 900000000000,
    "routeID": 1,
    "launchID": 910000000000
  }
}
```

Resource records should be keyed by planet ID and include:

- `planetID`
- `planetTypeID`
- `solarSystemID`
- persistent planet/resource seed values
- resource type IDs available on that planet
- display quality values returned by `GetPlanetResourceInfo`
- server-native resource layers by resource type:
  - background
  - hotspots
  - depletion events
- experimental generated coefficient bytes for non-null `GetResourceData`

Colony records should be keyed as `${planetID}:${ownerID}` and include:

- `planetID`
- `ownerID`
- `level`
- `currentSimTime`
- `pins`
- `links`
- `routes`
- per-colony next IDs if temporary client IDs need stable server remapping

Launch records should be keyed by launch ID and include:

- `launchID`
- `ownerID`
- `planetID`
- `solarSystemID`
- `launchTime`
- position
- contents
- expiry/deleted flags

## Phase 0: Open Planet View Safely

Goal: stop the current client crash and make the PI planet/resource view load with safe, persistent, deterministic data.

Server work:

- Add `planetMgr.Handle_MachoResolveObject`.
- Add `planetMgr.Handle_MachoBindObject`.
- Track bound-object ID to planet ID per session so later bound calls know which planet they represent.
- Implement `GetPlanetInfo()` with static planet metadata from `celestials`.
- Implement `GetPlanetResourceInfo()` with deterministic persistent P0 resource quality data.
- Implement `GetResourceData(info)` as a safe response. It may return `data: null` at first, allowing the client to keep its constant spherical harmonic instead of crashing.
- Return safe empty values for other read-only planet view calls:
  - `GetFullNetworkForOwner`
  - `GetCommandPinsForPlanet`
  - `GetExtractorsForPlanet`
  - `GetMyLaunchesDetails`
  - `DeleteLaunch`

Data to create:

- `planetRuntimeState` runtime table.
- Classic P0 resource type map per planet type for the planet/resource list.
- Persistent deterministic resource qualities for each visited planet.

Research/data still needed:

- Confirm the binary format expected by `PlanetResources.builder.CreateSHFromBuffer`.
- Determine whether a constant/null SH response is visually acceptable for Phase 0 or if the client requires a non-empty heat map for specific UI actions.
- Capture any next unhandled `planetMgr` calls after the planet view opens.

Tests:

- `MachoResolveObject` returns the local node.
- `MachoBindObject` returns a bound object and nested `GetPlanetInfo` works.
- Bound `GetPlanetInfo` resolves the correct planet.
- `GetPlanetResourceInfo` persists deterministic resource data.
- Empty foreign colony, extractor, command pin, and launch calls have stable shapes.

## Phase 1: Static PI Data Authority

Goal: expose all static PI data needed for validation, UI payloads, and simulation.

Server work:

- Add a PI static-data helper/module.
- Import or expose `planetSchematics.jsonl`.
- Build lookup helpers for:
  - P0 resources
  - P1/P2/P3/P4 commodities
  - command centers
  - ECUs
  - extractor heads
  - processors
  - storage facilities
  - launchpads
  - link CPU/power/bandwidth attributes
  - storage capacity attributes
  - import/export tax attributes
- Normalize type dogma access for CPU, power, capacity, cycle time, schematic inputs, and schematic outputs.

Data to create:

- `planetSchematics` static table from SDE JSONL.
- `planetIndustryTypes` or equivalent derived static table for groups/categories/attributes used by PI.
- Resource availability table if we decide not to keep the P0 map hardcoded.

Research/data still needed:

- Verify modern type/group IDs for all PI structures in this client build.
- Identify exact dogma attributes used by the client for PI fitting, storage, and tax calculations.
- Decide whether old extractor pin types need compatibility handling or can stay unsupported.

Tests:

- Static schematic lookup by schematic ID.
- Schematic lookup by output type ID.
- PI structure classification matches client `planetCommon.GetPinEntityType`.
- Dogma attribute helper returns expected CPU, power, storage, and tax fields.

## Phase 2: Colony Creation And Editing

Goal: let a character place, edit, submit, and reload a persistent colony.

Server work:

- Implemented `UserUpdateNetwork(serializedChanges)`.
- Implemented parsing for all command stream IDs:
  - create/remove pin
  - create/remove/upgrade link
  - create/remove route
  - set schematic
  - upgrade command center
  - add/remove/move extractor head
  - install program
- Implemented persistence in `planetRuntimeState.coloniesByKey`.
- Implemented serialized colony data matching client `ColonyData.RestorePinFromRow`, `RestoreLinkFromRow`, and `RestoreRouteFromRow`.
- Implemented `UserAbandonPlanet()`.
- `GetPlanetsForChar()` includes runtime colonies.
- Submit/abandon send basic planet notifications when the session supports them.
- Command-center deployment consumes the matching ship-inventory item after a successful submit and sends normal inventory item-change notifications.

Data to create:

- Implemented stable server pin ID allocator.
- Implemented stable route ID allocator.
- Optional command history/audit data for debugging serialized changes.

Research/data still needed:

- Temporary client pin/route IDs are handled by returning a fully serialized colony with server IDs. No separate remap payload has been needed so far.
- ISK and inventory hooks for placing command centers and structures.
- Skill requirements that the client does not enforce locally.
- Exact notification payload parity for multiplayer/client cache refreshes.
- Stacked command-center deployment behavior needs live-client verification if players can deploy directly from stacks larger than one.

Tests:

- All command stream IDs parse correctly.
- New colony persists in runtime state and appears in `GetPlanetsForChar()`.
- Submitted colony round-trips through client-shaped serialized rows.
- `GetProgramResultInfo()` returns deterministic placeholder ECU program values.
- `UserAbandonPlanet()` removes the runtime colony.
- Command-center item consumption removes the deployed item from ship inventory.
- Still needed: invalid ownership, duplicate command center, impossible links, and resource-limit rejection coverage.

## Phase 3: Resource Layers And ECU Programs

Goal: make resource scanning and ECU extraction meaningful and persistent.

Server work:

- Store persistent server-native resource layer seeds and hotspot data per planet/resource.
- Implement experimental `GetResourceData(info)` heatmap payloads while the exact spherical-harmonic buffer semantics are unknown:
  - ensure the planet/resource layer exists
  - generate deterministic little-endian `float32` coefficient bytes from the resource layer seed/hotspots
  - return `newBand * newBand * 4` bytes, matching EvEmu's observed wire-size rule
  - return `numBands = newBand`
  - marshal `data` as raw Python-string bytes, not a text string or PyBuffer
  - fall back to `data: null` only when the planet/resource/band request cannot be resolved
- Implement `GetProgramResultInfo(pinID, typeID, heads, headRadius)` from resource layer values.
- Apply client-style own-head overlap using `ecuOverlapFactor`.
- Use ECU dogma values where available:
  - extraction quantity
  - overlap factor
  - depletion range
  - depletion rate
- Implemented ECU program install data:
  - resource type
  - head radius
  - head coordinates
  - cycle time
  - quantity per cycle
  - install time
  - expiry time
- Apply a deterministic depletion/regeneration approximation:
  - each installed ECU program adds a persisted depletion event to the resource layer
  - active depletion lowers future output near those heads
  - expired depletion recovers over time

Data to create:

- Implemented: `resourcesByPlanetID[*].layersByTypeID`.
- Implemented per layer:
  - version
  - seed
  - quality
  - background
  - hotspots
  - depletion events
- Still needed for higher confidence resource heat maps: prove the experimental byte format against the client or replace it with a closer `_eveplanetresources` coefficient encoder.
- Implemented experimental converter:
  - source: server-native layer seed, quality, hotspots, and depletion events
  - output: first `newBand^2` generated `float32` coefficients
  - goal: visible client heatmap, not live-server accuracy

Research/data still needed:

- Validate whether the V23 client accepts the experimental coefficient buffer.
- Exact spherical harmonic coefficient ordering/normalization for `CreateSHFromBuffer`.
- A live capture of a successful `GetResourceData(info)` response with non-null `data` would unblock the encoder if the experimental buffer fails.
- If we need live data, capture for one planet/resource at several `newBand` values, ideally `3`, `5`, `15`, and `30`; include `resourceTypeID`, `oldBand`, `newBand`, `proximity`, returned `numBands`, returned byte length, and returned data hex/base64.
- Client constants for resource proximity/bands versus skills are partially identified, but the decompiled `appConst.py` does not expose the proximity limit tuples cleanly.
- Server output math now follows the useful parts of client `baseColony.CreateProgram`: layer value sampling, ECU max volume, program length, cycle time, and own-head overlap. Remaining parity work is other-colony/other-ECU overlap and exact live depletion/noise curves.
- Decide whether to keep the deterministic depletion approximation or pursue closer Tranquility-style depletion behavior.

Tests:

- Implemented: resource layer records persist with stable hotspot data.
- Implemented: resource value sampling is deterministic and clamped to the client max value.
- Implemented: ECU output is deterministic for the same planet/resource/head positions.
- Implemented: installed programs persist and write depletion events.
- Implemented: depletion reduces later output around the same heads.
- Implemented: resource data response returns deterministic `newBand^2 * 4` byte payloads and larger-band payloads preserve smaller-band prefixes.
- Still needed: client-side validation of the experimental heatmap encoder.
- Expired programs stop producing.

## Phase 4: Colony Simulation And Manufacturing

Goal: make colonies produce materials over time.

Server work:

- Implement authoritative lazy simulation on:
  - `GetPlanetInfo`
  - `UserUpdateNetwork`
  - `UserTransferCommodities`
  - `UserLaunchCommodities`
  - import/export
- Route ECU output into destination pins.
- Run processor cycles using schematics.
- Enforce storage capacity.
- Enforce route path/link validity and bandwidth.
- Implement expedited transfers and cooldown/runtime updates.

Data to create:

- Simulation checkpoint fields on colony and pin records.
- Optional per-cycle debug trace guarded by config.

Research/data still needed:

- Confirm processor backlog/overflow behavior expected by the client.
- Confirm route max hop limits and link bandwidth formulas.
- Confirm command center and launchpad storage behavior.

Tests:

- P0 routes from ECU to storage/processor.
- Basic processor P0 to P1 cycle.
- Advanced/high-tech processor schematic cycles.
- Overflow cases do not duplicate materials.
- Simulation is idempotent when called repeatedly at the same timestamp.

## Phase 5: Launches, Customs Offices, And Import/Export

Goal: complete material movement between planet surface, space, customs office, and inventory.

Server work:

- Implement `UserLaunchCommodities`.
- Persist launch containers and expose them through `GetMyLaunchesDetails`.
- Implement launch deletion/expiry.
- Spawn or expose launch pickup locations as needed by space/warp code.
- Add `planetOrbitalRegistryBroker`.
- Implement `GetTaxRate(customsOfficeID)`.
- Ensure customs office slim items expose `planetID`.
- Extend inventory bound objects with `ImportExportWithPlanet`.
- Move commodities between customs-office inventory and launchpad pin contents.
- Charge taxes where economy support exists.

Data to create:

- Customs office/orbital registry state.
- Per-character customs office hangar contents if not already represented by inventory.
- Launch container inventory/state.

Research/data still needed:

- Current server representation of POCO/customs office items.
- Whether nullsec skyhooks need to replace customs offices for this client/server world.
- Tax formula parity and owner/access rules.
- Wallet journal entries needed by the client.

Tests:

- Command center launch removes pin contents and creates launch details.
- Journal launch list renders active and expired launches.
- Import/export transfers items correctly.
- Tax changes trigger `TaxChanged` behavior.
- No duplication across failed import/export attempts.

## Phase 6: Multiplayer Visibility And Polish

Goal: make PI visible, stable, and maintainable in normal play.

Server work:

- Implement other-character command center/extractor visibility.
- Implement full foreign colony network payloads.
- Add GM/debug calls only if useful for server operators.
- Add periodic cleanup for expired launches and abandoned state.
- Add admin diagnostics for planet resources, colony state, and simulation deltas.

Data to create:

- Optional PI diagnostics snapshots.
- Optional migration tooling for `planetRuntimeState` schema changes.

Research/data still needed:

- Exact notification payloads for all client cache invalidation paths.
- Any client-side assumptions around corp/shared PI that we choose to support later.

Tests:

- Other-player command centers render without revealing private data.
- Notifications refresh planet windows and colony list.
- Runtime migration preserves existing colonies/resources.
