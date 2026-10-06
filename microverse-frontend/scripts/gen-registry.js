const fs = require('fs');
const path = require('path');

const rarities = ['common', 'uncommon', 'rare', 'legendary'];
const behaviors = {
  agent: ['idle', 'walk', 'work', 'trade', 'sleep', 'socialize', 'fight', 'craft'],
  wildlife: ['roam', 'hunt', 'flee', 'graze', 'sleep', 'migrate'],
  flora: ['grow', 'bloom', 'fruit', 'wither'],
  structure: ['build', 'occupy', 'produce', 'repair', 'defend'],
  resource: ['collect', 'store', 'craft', 'trade', 'consume'],
  event: ['announce', 'peak', 'resolve', 'fade']
};

function ent(id, name, category, sprite, stats, tree, interactions) {
  return { entity_id: id, name, category, sprite_ref: sprite, stats, behavior_tree: tree, interactions };
}

function splitName(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

const agents = [
  ['Farmer', 'farmer'], ['Merchant', 'merchant'], ['Guard', 'guard'], ['Scholar', 'scholar'], ['Healer', 'healer'],
  ['Warrior', 'warrior'], ['Archer', 'archer'], ['Knight', 'knight'], ['Paladin', 'paladin'], ['Assassin', 'assassin'],
  ['Wizard', 'wizard'], ['Sorcerer', 'sorcerer'], ['Necromancer', 'necromancer'], ['Druid', 'druid'], ['Shaman', 'shaman'],
  ['King', 'king'], ['Queen', 'queen'], ['Prince', 'prince'], ['Princess', 'princess'], ['Duke', 'duke'],
  ['Blacksmith', 'blacksmith'], ['Carpenter', 'carpenter'], ['Mason', 'mason'], ['Weaver', 'weaver'], ['Potter', 'potter'],
  ['Bard', 'bard'], ['Jester', 'jester'], ['Poet', 'poet'], ['Painter', 'painter'], ['Sculptor', 'sculptor'],
  ['Miner', 'miner'], ['Fisher', 'fisher'], ['Hunter', 'hunter'], ['Cook', 'cook'], ['Baker', 'baker'],
  ['Innkeeper', 'innkeeper'], ['Sailor', 'sailor'], ['Cartographer', 'cartographer'], ['Alchemist', 'alchemist'], ['Herbalist', 'herbalist'],
  ['Priest', 'priest'], ['Monk', 'monk'], ['Nun', 'nun'], ['Judge', 'judge'], ['Sheriff', 'sheriff'],
  ['Thief', 'thief'], ['Spy', 'spy'], ['Diplomat', 'diplomat'], ['Banker', 'banker'], ['Shepherd', 'shepherd'],
  ['Beekeeper', 'beekeeper'], ['Glassblower', 'glassblower'], ['Jeweler', 'jeweler'], ['Tailor', 'tailor'], ['Cobbler', 'cobbler'],
  ['Lumberjack', 'lumberjack'], ['Stablehand', 'stablehand'], ['Courier', 'courier'], ['Librarian', 'librarian'], ['Chronicler', 'chronicler'],
  ['Oracle', 'oracle'], ['Ranger', 'ranger'], ['Berserker', 'berserker'], ['Samurai', 'samurai'], ['Ninja', 'ninja'],
  ['Pirate', 'pirate'], ['Explorer', 'explorer'], ['Inventor', 'inventor'], ['Engineer', 'engineer'], ['Architect', 'architect'],
  ['Mayor', 'mayor'], ['Councillor', 'councillor'], ['Tax Collector', 'tax_collector'], ['Beggar', 'beggar'], ['Refugee', 'refugee'],
  ['Child', 'child'], ['Elder', 'elder'], ['Midwife', 'midwife'], ['Veterinarian', 'vet'], ['Falconer', 'falconer'],
  ['Gladiator', 'gladiator'], ['Champion', 'champion'], ['Warlord', 'warlord'], ['Empress', 'empress'], ['Vizier', 'vizier'],
  ['Scribe', 'scribe'], ['Apothecary', 'apothecary'], ['Brewer', 'brewer'], ['Chandler', 'chandler'], ['Miller', 'miller']
];

const wildlife = [
  ['Lion', 'lion'], ['Tiger', 'tiger'], ['Elephant', 'elephant'], ['Giraffe', 'giraffe'], ['Zebra', 'zebra'],
  ['Eagle', 'eagle'], ['Hawk', 'hawk'], ['Owl', 'owl'], ['Parrot', 'parrot'], ['Penguin', 'penguin'],
  ['Shark', 'shark'], ['Whale', 'whale'], ['Dolphin', 'dolphin'], ['Octopus', 'octopus'], ['Crab', 'crab'],
  ['Dragon', 'dragon'], ['Phoenix', 'phoenix'], ['Unicorn', 'unicorn'], ['Griffin', 'griffin'], ['Hydra', 'hydra'],
  ['Wolf', 'wolf'], ['Bear', 'bear'], ['Deer', 'deer'], ['Fox', 'fox'], ['Boar', 'boar'],
  ['Rabbit', 'rabbit'], ['Squirrel', 'squirrel'], ['Raven', 'raven'], ['Crow', 'crow'], ['Bat', 'bat'],
  ['Snake', 'snake'], ['Crocodile', 'crocodile'], ['Turtle', 'turtle'], ['Frog', 'frog'], ['Bee', 'bee'],
  ['Butterfly', 'butterfly'], ['Spider', 'spider'], ['Scorpion', 'scorpion'], ['Horse', 'horse'], ['Camel', 'camel'],
  ['Kraken', 'kraken'], ['Basilisk', 'basilisk'], ['Chimera', 'chimera'], ['Pegasus', 'pegasus'], ['Wyvern', 'wyvern'],
  ['Manticore', 'manticore'], ['Sphinx', 'sphinx'], ['Cerberus', 'cerberus'], ['Minotaur', 'minotaur'], ['Cyclops', 'cyclops'],
  ['Mermaid', 'mermaid'], ['Selkie', 'selkie'], ['Yeti', 'yeti'], ['Sasquatch', 'sasquatch'], ['Chupacabra', 'chupacabra'],
  ['Kitsune', 'kitsune'], ['Thunderbird', 'thunderbird'], ['Sea Serpent', 'sea_serpent'], ['Dire Wolf', 'dire_wolf'], ['Mammoth', 'mammoth']
];

const flora = [
  ['Wheat Crop', 'wheat'], ['Apple Tree', 'apple'], ['Desert Cactus', 'cactus'], ['Forest Mushroom', 'mushroom'], ['Rose Bush', 'rose'],
  ['Oak Tree', 'oak'], ['Pine Tree', 'pine'], ['Birch Tree', 'birch'], ['Willow Tree', 'willow'], ['Palm Tree', 'palm'],
  ['Corn', 'corn'], ['Rice', 'rice'], ['Potato', 'potato'], ['Tomato', 'tomato'], ['Carrot', 'carrot'],
  ['Berry Bush', 'berry'], ['Grape Vine', 'grape'], ['Orange Tree', 'orange'], ['Lemon Tree', 'lemon'], ['Olive Tree', 'olive'],
  ['Lavender', 'lavender'], ['Sunflower', 'sunflower'], ['Tulip', 'tulip'], ['Lily', 'lily'], ['Daisy', 'daisy'],
  ['Fern', 'fern'], ['Moss', 'moss'], ['Ivy', 'ivy'], ['Bamboo', 'bamboo'], ['Reed', 'reed'],
  ['Healing Herb', 'heal_herb'], ['Poison Ivy', 'poison_ivy'], ['Mandrake', 'mandrake'], ['Nightshade', 'nightshade'], ['Wolfsbane', 'wolfsbane'],
  ['Crystal Flower', 'crystal_flower'], ['Glowshroom', 'glowshroom'], ['World Tree', 'world_tree'], ['Yggdrasil Sapling', 'yggdrasil'], ['Ent Seed', 'ent_seed'],
  ['Cotton Plant', 'cotton_plant'], ['Flax', 'flax'], ['Hemp', 'hemp'], ['Tobacco', 'tobacco'], ['Sugarcane', 'sugarcane']
];

const structures = [
  ['Castle', 'castle'], ['Fortress', 'fortress'], ['Palace', 'palace'], ['Temple', 'temple'], ['Pyramid', 'pyramid'],
  ['University', 'university'], ['Observatory', 'observatory'], ['Arena', 'arena'], ['Colosseum', 'colosseum'], ['Theater', 'theater'],
  ['Hospital', 'hospital'], ['Library', 'library'], ['Museum', 'museum'], ['Gallery', 'gallery'], ['Archive', 'archive'],
  ['Farm', 'farm'], ['Ranch', 'ranch'], ['Vineyard', 'vineyard'], ['Orchard', 'orchard'], ['Greenhouse', 'greenhouse'],
  ['Wood Hut', 'hut'], ['Stone Windmill', 'windmill'], ['Wood Port', 'port'], ['Stone Tower', 'tower'], ['Wood Bridge', 'bridge'],
  ['Market', 'market'], ['Blacksmith Shop', 'forge'], ['Tavern', 'tavern'], ['Inn', 'inn'], ['Barracks', 'barracks'],
  ['Warehouse', 'warehouse'], ['Granary', 'granary'], ['Well', 'well'], ['Fountain', 'fountain'], ['Lighthouse', 'lighthouse'],
  ['Dock', 'dock'], ['Shipyard', 'shipyard'], ['Mine', 'mine'], ['Quarry', 'quarry'], ['Sawmill', 'sawmill'],
  ['Cathedral', 'cathedral'], ['Shrine', 'shrine'], ['Monastery', 'monastery'], ['Academy', 'academy'], ['Guild Hall', 'guild_hall'],
  ['Prison', 'prison'], ['Courthouse', 'courthouse'], ['Bank', 'bank'], ['Embassy', 'embassy'], ['Watchtower', 'watchtower'],
  ['Wall', 'wall'], ['Gate', 'gate'], ['Moat', 'moat'], ['Siege Workshop', 'siege_workshop'], ['Alchemy Lab', 'alchemy_lab'],
  ['Bathhouse', 'bathhouse'], ['Garden', 'garden'], ['Statue', 'statue'], ['Monument', 'monument'], ['Cemetery', 'cemetery'],
  ['Stable', 'stable'], ['Kennel', 'kennel'], ['Aviary', 'aviary'], ['Aquarium', 'aquarium'], ['Zoo', 'zoo'],
  ['Mill', 'mill'], ['Bakery', 'bakery'], ['Brewery', 'brewery'], ['Tannery', 'tannery'], ['Pottery Workshop', 'pottery_workshop']
];

const resources = [
  ['Mithril', 'mithril'], ['Adamantium', 'adamantium'], ['Orichalcum', 'orichalcum'], ['Iron Ore', 'iron'], ['Copper Ore', 'copper'],
  ['Ruby', 'ruby'], ['Sapphire', 'sapphire'], ['Emerald', 'emerald'], ['Diamond', 'diamond'], ['Amethyst', 'amethyst'],
  ['Pizza', 'pizza'], ['Sushi', 'sushi'], ['Steak', 'steak'], ['Cake', 'cake'], ['Wine', 'wine'],
  ['Silk', 'silk'], ['Velvet', 'velvet'], ['Marble', 'marble'], ['Crystal', 'crystal'], ['Glass', 'glass'],
  ['Wood Log', 'wood'], ['Stone', 'stone'], ['Wheat', 'wheat'], ['Health Potion', 'potion'], ['Green Herb', 'herb'],
  ['Gold', 'gold'], ['Silver', 'silver'], ['Bronze', 'bronze'], ['Coal', 'coal'], ['Oil', 'oil'],
  ['Bread', 'bread'], ['Cheese', 'cheese'], ['Milk', 'milk'], ['Honey', 'honey'], ['Fish', 'fish'],
  ['Leather', 'leather'], ['Wool', 'wool'], ['Cotton', 'cotton'], ['Linen', 'linen'], ['Paper', 'paper'],
  ['Ink', 'ink'], ['Rope', 'rope'], ['Nails', 'nails'], ['Tools', 'tools'], ['Weapons', 'weapons'],
  ['Armor', 'armor'], ['Torch', 'torch'], ['Candle', 'candle'], ['Lamp Oil', 'lamp_oil'], ['Gunpowder', 'gunpowder'],
  ['Mana Crystal', 'mana'], ['Soul Gem', 'soul_gem'], ['Phoenix Feather', 'phoenix_feather'], ['Dragon Scale', 'dragon_scale'], ['Unicorn Horn', 'unicorn_horn'],
  ['Topaz', 'topaz'], ['Opal', 'opal'], ['Pearl', 'pearl'], ['Jade', 'jade'], ['Obsidian', 'obsidian'],
  ['Salt', 'salt'], ['Spice', 'spice'], ['Tea', 'tea'], ['Coffee', 'coffee'], ['Chocolate', 'chocolate'],
  ['Ale', 'ale'], ['Mead', 'mead'], ['Whiskey', 'whiskey'], ['Juice', 'juice'], ['Fresh Water', 'fresh_water']
];

const events = [
  ['Royal Wedding', 'royal_wedding'], ['Coronation', 'coronation'], ['Tournament', 'tournament'], ['Festival', 'festival'],
  ['Eclipse', 'eclipse'], ['Comet', 'comet'], ['Meteor Shower', 'meteor'], ['Aurora', 'aurora'],
  ['Earthquake', 'earthquake'], ['Tsunami', 'tsunami'], ['Volcanic Eruption', 'volcano'],
  ['Plague', 'plague'], ['Famine', 'famine'], ['War', 'war'], ['Peace Treaty', 'peace'],
  ['Thunderstorm', 'storm'], ['Harvest Festival', 'harvest_fest'], ['Black Plague', 'black_plague'], ['Solar Eclipse', 'solar_eclipse'],
  ['Flash Flood', 'flood'], ['Tornado', 'tornado'], ['Severe Drought', 'drought'], ['Blizzard', 'blizzard'], ['Sandstorm', 'sandstorm'],
  ['Hailstorm', 'hail'], ['Dense Fog', 'fog'], ['Market Crash', 'market_crash'], ['Gold Rush', 'gold_rush'], ['Rebellion', 'rebellion'],
  ['Invasion', 'invasion'], ['Discovery', 'discovery'], ['Invention', 'invention'], ['Migration', 'migration'], ['Census', 'census'],
  ['Tax Reform', 'tax_reform'], ['Carnival', 'carnival'], ['Masquerade', 'masquerade'], ['Joust', 'joust'], ['Duel of Honor', 'duel'],
  ['Pirate Raid', 'pirate_raid'], ['Merchant Caravan', 'caravan'], ['Prophet Vision', 'prophecy'], ['Blood Moon', 'blood_moon'], ['Starfall', 'starfall'],
  ['Locust Swarm', 'locust'], ['Wildfire', 'wildfire'], ['Avalanche', 'avalanche'], ['Landslide', 'landslide'], ['Sinkhole', 'sinkhole'],
  ['Diplomatic Summit', 'summit'], ['Trade Fair', 'trade_fair'], ['Art Exhibition', 'art_show'], ['Music Concert', 'concert'], ['Sports Games', 'games']
];

const agentItems = agents.map(([name, slug], i) => {
  const rarity = rarities[Math.min(3, Math.floor(i / 25))];
  return ent('agent_' + slug, name, 'agent', 'npc_' + slug + '_01', {
    hp: 60 + ((i * 7) % 100), speed: +(0.8 + (i % 5) * 0.2).toFixed(1), rarity
  }, behaviors.agent, ['talk', 'trade', 'work']);
});

const wildItems = wildlife.map(([name, slug], i) => {
  const rarity = rarities[Math.min(3, Math.floor(i / 15))];
  return ent('wild_' + slug, name, 'wildlife', 'wild_' + slug + '_01', {
    hp: 40 + ((i * 11) % 180), speed: +(1.5 + (i % 6) * 0.4).toFixed(1), rarity
  }, behaviors.wildlife, ['hunt', 'flee', 'tame']);
});

const floraItems = flora.map(([name, slug], i) => {
  const rarity = rarities[Math.min(3, Math.floor(i / 12))];
  return ent('flora_' + slug, name, 'flora', 'flora_' + slug + '_01', {
    growth_time: 20 + (i % 80), yield: 2 + (i % 10), rarity
  }, behaviors.flora, ['harvest', 'plant']);
});

const structItems = structures.map(([name, slug], i) => {
  const rarity = rarities[Math.min(3, Math.floor(i / 18))];
  return ent('struct_' + slug, name, 'structure', 'struct_' + slug + '_01', {
    durability: 100 + (i * 15) % 500, capacity: (i % 20) + 1, rarity
  }, behaviors.structure, ['enter', 'repair']);
});

const resItems = resources.map(([name, slug], i) => {
  const rarity = rarities[Math.min(3, Math.floor(i % 18 === 0 ? 3 : i / 18))];
  return ent('res_' + slug, name, 'resource', 'res_' + slug + '_01', {
    value: 5 + (i * 7) % 200, stack_size: 5 + (i % 50), rarity
  }, behaviors.resource, ['collect', 'trade']);
});

const eventItems = events.map(([name, slug], i) => {
  const rarity = rarities[Math.min(3, Math.floor(i / 14))];
  return ent('event_' + slug, name, 'event', 'event_' + slug + '_01', {
    duration: 10 + (i % 50), intensity: 1 + (i % 10), rarity
  }, behaviors.event, ['observe', 'join']);
});

const total = agentItems.length + wildItems.length + floraItems.length + structItems.length + resItems.length + eventItems.length;

const reg = {
  version: '2.0',
  description: 'Microverse 500+ Entity Registry — Frontend Catalog',
  categories: {
    agents: { count: agentItems.length, items: agentItems },
    wildlife: { count: wildItems.length, items: wildItems },
    flora: { count: floraItems.length, items: floraItems },
    structures: { count: structItems.length, items: structItems },
    resources: { count: resItems.length, items: resItems },
    events: { count: eventItems.length, items: eventItems }
  },
  systems: ['social_ai', 'economy', 'conflict_politics', 'culture', 'environment', 'gameplay', 'visual', 'analytics', 'observer'],
  total_entities: total,
  last_updated: '2026-10-06'
};

const out = path.join(__dirname, '..', 'src', 'data', 'registry.json');
fs.writeFileSync(out, JSON.stringify(reg, null, 2));
console.log('Wrote', total, 'entities to', out);
Object.entries(reg.categories).forEach(([k, v]) => console.log(k + ':', v.count));
