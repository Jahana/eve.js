**Eve-JS Discord (come say hey!): https://discord.gg/KMuJrMDEBa**

# EvEJS Elysian - Features & How to setup!

**With special thanks to: Icey for founding this project, JohnElysian for losing a month of his life and bringing you most of the below features, and Deer_Hunter whom without, this release wouldn't be where it is**

Run the latest EVE Online private server version. We are functional against the latest client patch as of 2nd April, 2026.

EvEJS is already well past the initial ship spinning stage (thank you icey!!!), we've got a LOT here, many of which has never been done at all, or done but never a native proper way, Current features include:

*Note: unless specifically said it is all there - there might be missing bits, some big, some tiny, this is NOT a fully complete eve server. The list below follows this too.*

*Note 2: I am aware of jolts that can occur, but due to a lack of time to re-fix them after i broke them, here we are! update soon will eliminate this :)*

- :rocket: Time dilation is fully implemented. However, a lot has changed, so auto-scaling TiDi is turned off by default due to lack of time to test edge cases. /tidi <0.1-1.0> is fully operational!
- :rocket: Warping, stargates, jumping, session changes, and 1-1 station/upwell undock positioning for all hull types. (Hey ccp, forget to include something in your SDE?)
- :rocket: Following on from that, we also have 1-1 fighter abilities, sov protocol, and various other things not in the SDE that, is supposed to have all client data inside it! :)
- :rocket: Radials! (the circle around modules, yeeeep, that was us!)
- :rocket: Missiles!! Including 1-1 native trinity engine long-range missiles (this was NOT an easy task, many, many days were spent), Turrets, Hybrids, Projectiles, etc! and a broad chunk of live ship combat behavior. (However, expect bugs, I am one person, testing is the long bit!)
- :rocket: SKINS! Ship skins, (all skins granted on character creation) AND structure skins! Incredible.
- :rocket: A good chunk of MINING/Asteroid belts! Regeneration, depletion, real rocks, real lasers! NOTE: We ALSO have the mining NPC fleet that comes and mines too, and actually drops it off in a hauler that arrives to collect from them too! Spawning 10 of these fleets and watching them Asteroid belts down, is extremely fun, and visually awesome.
- :rocket: Omega, but properly! By default you are Omega until 2100.
- :rocket: Real CONCORD and NPCs. These are real, using real concord/npc modules and entities. This is heavily optimised, using clever tactics, such as visiblity inside the very advanced grid/cluster overview system, Concord is on at all gates with crimewatch on as default.
- :rocket: Corporation and alliance almost fully! Sov, hangers, voting, roles, shares etc!
- :rocket: Chat, fleets, wallet, (evermarks, plex, etc!), and a lot of the day-to-day social surface. (expect bugs, particularly with fleets due to lack of testing time!)
- :rocket: Plex! Full plex vault and system.
- :rocket: Citadels and upwell structures core functionaliy! Core sovereignty and sov structures, also in! (expect bugs!)
- :rocket: CCP-sized overview, cluster bootstrap, and giant-grid visibility work.
- :rocket: FULL Market! This is a ABSURDLY benchmarked, and fast standalone market server for seeded markets, browsing, order books, and transactions. You can seed the ENTIRE market, with by default, 5000 items in every single station, with buy/sell orders, of 500, and a full 30 day market history, and it will load instantly*. This is written in rust, and i am extremely proud of it. NOTE: Do not host this on a seperate machine. In its current state it can be done with some hackery, but things wont work great. This, at present, is designed to run in a seperate process, but otherwise the server & market server, should be on the machine! 
- :rocket: HyperNet, New Eden Store (plus an editor, checkout is fake, auto succeeds!), EverMarks, heraldry, emblems! (Emblem licence granted by command as Paragon agents where you get emblems in TQ, is not added)
- :rocket: Character creation, portraits, and paperdolls! Plus recustomisation, fully supported.
- :rocket: Roughly half of the live module/gameplay surface is already in place, with more landing constantly. I can't rememeber numbers, but roughly 50% of all modules are added, namely, turrets, passive modules, propulsion, ship repairers/boosters
- :rocket: Capacitor and shield recharge!
- :rocket: Official Stargate orientation, this is calculcated by the direction of the gate in the destination system, super super cool! They all face eachother! (This is how it works on TQ, too!)
- :rocket: Fitting is in! (However, needs polish!)
- :rocket: Asset overview is ABSURDLY fast too. Like, absurdly. Did I mention the market-server is also absurdly fast, abusrdly, its criminal. over 200+ million rows are built with the seeder to fully seed the entire universe, and it loads INSTANTLY cold. It's criminal, I love it.
- :rocket: reloading, tooltips, etc all working! (However, some ranges displayed can be off?) There is a known, random, bug with your modules not always glowing green, just re-undock/jump/relog/?reload ammo?

Known missing:
-  Missions/Cosmic anonomiles/Sites - Nowhere supplies the official data for this, some of us (big ups Vekotov, are working on the gruelling process of flying around TQ and mapping these out! A hero!)
- Skill queues, Module grouping/Weapon banks, full actions triggering crimewatch, npc warping bug, Tidi autoscaler needs re-visitng, Citadels self defence/fuel, Pos's, fighter bugs, super weapons/lances, sec status history, and some various other bits!

**If you use our project, please respect it, and dont claim the work as your very own.**

**Note: Dev mode in the server config is enabled by default, disable this to go through a normal flow, such as starter skills. Starter items are not added yet. This means, to create an account, just login with the desired user/pass to create it, dev mode also disabled passwords needing to be right to login to that account. Default accounts are test/test and test2/test2 -- I would leave GM Elysian, it is the servers Hypernet seed character

Good luck! - EvE JS Elysian team.

Please read the documentation, including what each tool does.

**TO GET STARTED, YOU ONLY NEED THE /Tools/ClientSETUP!**




If you just want the fast version, it is this:

## Quick Start

1. Install Node.js `LTS`.
2. Open this repo in Terminal and run:

```powershell
npm ci
npm --prefix server ci
```

3. Double-click `tools\ClientSETUP\StartClientSetup.bat`.
4. Point it at a copied EVE client folder and let it finish.
5. Double-click `StartServer.bat`.
6. Choose `2` for `Server + Play`.

That is the normal plug-and-play path.

## What The Setup Wizard Handles

`tools\ClientSETUP\StartClientSetup.bat` does the annoying first-time jobs for you:

- saves your client path
- installs the EvEJS certificate
- patches the copied client
- points the client at the local server
- checks the client build it expects

You do not need to patch files by hand, edit certificates by hand, or dig around in internal folders.

## Optional: Standalone Market Server

The standalone market is optional.

You do **not** need it just to boot the server and log in.

Use it if you want the faster seeded market experience:

1. Double-click `BuildMarketSeed.bat`
2. Pick `Jita + New Caldari` for the easiest first seed
3. Wait for the seed build to finish
4. Double-click `StartMarketServer.bat`
5. Leave that window open while you play

If Rust is missing, the market tools will tell you and point you at the right install path.

## What Most People Should Click

- `tools\ClientSETUP\StartClientSetup.bat`
  First-time setup. Best first click.
- `StartServer.bat`
  Best daily launcher. It can run the server only, or the server and game together.
- `Play.bat`
  Launches the client by itself after setup is done.
- `BuildMarketSeed.bat`
  Optional. Builds the standalone market database.
- `StartMarketServer.bat`
  Optional. Runs the fast standalone market daemon.
- `tools\ConfigEditor\OpenServerConfig.bat`
  Opens the desktop config and data editor for local server settings and player data.

## Friendly Guides

- [Start here](doc/SETUP.md)
- [Launcher guide](doc/LAUNCHERS.md)
- [Optional market setup](doc/MARKET_SETUP.md)
- [Market seeder guide](doc/MARKET_SEEDER.md)
- [Troubleshooting](doc/TROUBLESHOOTING.md)
- [Tools and admin basics](doc/TOOLS.md)
- [Feature audit](doc/IMPLEMENTED_FEATURE_STATUS.txt)

## Good To Know

- Use a **copy** of your EVE client, not the one you normally play on.
- The main setup path is Windows-first.
- `doc/Olddocs` is legacy reference material. The current player-friendly guides live in `doc/`.
- Some folders under `tools/` are maintainer-only. If a guide does not mention them, you can ignore them.

## Want The Long Version?

Start with [doc/SETUP.md](doc/SETUP.md).
