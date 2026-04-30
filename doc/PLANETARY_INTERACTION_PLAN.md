# Planetary Interaction Implementation Plan

This plan tracks implementation of EVE Planetary Interaction, also known as PI. The immediate client crash is caused by `planetMgr` not handling moniker resolution, but the full feature spans planet view data, persistent colonies, resource simulation, production, inventory, customs offices, and notifications.

Alpha clone limits are not a gameplay goal for this server. Only implement those checks if the client explicitly requires a server response to keep the UI stable.

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
- later: resource layer coefficients/bands used by `GetResourceData`

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

- Implement `UserUpdateNetwork(serializedChanges)`.
- Parse all command stream IDs:
  - create/remove pin
  - create/remove/upgrade link
  - create/remove route
  - set schematic
  - upgrade command center
  - add/remove/move extractor head
  - install program
- Persist colonies in `planetRuntimeState.coloniesByKey`.
- Return serialized colony data matching client `ColonyData.RestorePinFromRow`, `RestoreLinkFromRow`, and `RestoreRouteFromRow`.
- Add `UserAbandonPlanet()`.
- Update `GetPlanetsForChar()` to include runtime colonies.
- Send relevant planet notifications after submit/abandon.

Data to create:

- Stable server pin ID allocator.
- Stable route ID allocator.
- Optional command history/audit data for debugging serialized changes.

Research/data still needed:

- Exact handling of temporary client pin/route IDs during submit.
- Whether the client expects submit to return ID remapping or only a fully serialized colony.
- ISK and inventory hooks for placing command centers and structures.
- Skill requirements that the client does not enforce locally.

Tests:

- All command stream IDs parse correctly.
- New colony persists across service instance reload.
- Submitted colony round-trips through client-shaped serialized rows.
- Invalid ownership, duplicate command center, and impossible links are rejected.

## Phase 3: Resource Layers And ECU Programs

Goal: make resource scanning and ECU extraction meaningful and persistent.

Server work:

- Replace Phase 0 null resource layer data with real layer payloads for `GetResourceData(info)`.
- Store persistent resource layer seeds/coefficient data per planet/resource.
- Implement `GetProgramResultInfo(pinID, typeID, heads, headRadius)`.
- Implement ECU program install data:
  - resource type
  - head radius
  - head coordinates
  - cycle time
  - quantity per cycle
  - install time
  - expiry time
- Apply depletion/regeneration rules or a deterministic approximation.

Data to create:

- Resource layer coefficients or server-native layer model per planet/resource.
- Program output history or depletion state.

Research/data still needed:

- Exact spherical harmonic buffer format for `CreateSHFromBuffer`.
- Client constants for resource proximity/bands versus skills.
- Output math parity with client `baseColony.CreateProgram` and ECU pin logic.
- How much depletion fidelity is worth implementing for this server.

Tests:

- Resource data response upgrades bands based on request info.
- ECU output is deterministic for the same planet/resource/head positions.
- Installed program persists and reloads.
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
