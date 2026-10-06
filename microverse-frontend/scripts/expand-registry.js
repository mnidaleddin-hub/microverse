const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'src', 'data', 'registry.json');
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
const rar = ['common', 'uncommon', 'rare', 'legendary'];

function splitName(n) {
  return n.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function add(key, items) {
  const arr = r.categories[key].items;
  for (const it of items) {
    if (arr.some((x) => x.entity_id === it.entity_id)) continue;
    arr.push(it);
  }
  r.categories[key].count = arr.length;
}

const extras = [
  ['Herald', 'herald'], ['Falcon Master', 'falcon_master'], ['Siege Engineer', 'siege_eng'], ['Quartermaster', 'quartermaster'],
  ['Admiral', 'admiral'], ['Captain', 'captain'], ['First Mate', 'first_mate'], ['Cabin Boy', 'cabin_boy'],
  ['Witch', 'witch'], ['Warlock', 'warlock'], ['Enchanter', 'enchanter'], ['Runesmith', 'runesmith'],
  ['Beastmaster', 'beastmaster'], ['Tamer', 'tamer'], ['Whisperer', 'whisperer'], ['Tracker', 'tracker'],
  ['Forager', 'forager'], ['Scavenger', 'scavenger'], ['Prospector', 'prospector'], ['Gemcutter', 'gemcutter'],
  ['Clockmaker', 'clockmaker'], ['Locksmith', 'locksmith'], ['Armorer', 'armorer'], ['Fletcher', 'fletcher'],
  ['Farrier', 'farrier'], ['Wheelwright', 'wheelwright'], ['Cooper', 'cooper'], ['Basket Weaver', 'basket_weaver'],
  ['Dyer', 'dyer'], ['Embroiderer', 'embroiderer'], ['Perfumer', 'perfumer'], ['Soap Maker', 'soap_maker'],
  ['Ice Harvester', 'ice_harvester'], ['Salt Miner', 'salt_miner'], ['Coral Diver', 'coral_diver'], ['Pearl Diver', 'pearl_diver'],
  ['Sky Watcher', 'sky_watcher'], ['Astrologer', 'astrologer'], ['Numerologist', 'numerologist'], ['Philosopher', 'philosopher'],
  ['Rebel', 'rebel'], ['Loyalist', 'loyalist'], ['Mercenary', 'mercenary'], ['Bodyguard', 'bodyguard'],
  ['Messenger', 'messenger'], ['Town Crier', 'town_crier'], ['Matchmaker', 'matchmaker'], ['Wedding Planner', 'wedding_planner'],
  ['Gravedigger', 'gravedigger'], ['Undertaker', 'undertaker'], ['Exorcist', 'exorcist'], ['Inquisitor', 'inquisitor'],
  ['Smuggler', 'smuggler'], ['Fence', 'fence'], ['Pickpocket', 'pickpocket'], ['Cutpurse', 'cutpurse'],
  ['Noble', 'noble'], ['Baron', 'baron'], ['Count', 'count'], ['Marquis', 'marquis'],
  ['Lady in Waiting', 'lady_waiting'], ['Squire', 'squire'], ['Page', 'page'], ['Heraldist', 'heraldist']
];

extras.forEach(([n, s], i) => {
  add('agents', [{
    entity_id: 'agent_' + s, name: n, category: 'agent', sprite_ref: 'npc_' + s + '_01',
    stats: { hp: 70 + (i % 50), speed: 1 + (i % 3) * 0.2, rarity: rar[i % 4] },
    behavior_tree: ['idle', 'walk', 'work', 'sleep'], interactions: ['talk', 'trade']
  }]);
});

const moreWild = [
  ['Moose', 'moose'], ['Lynx', 'lynx'], ['Panther', 'panther'], ['Hyena', 'hyena'], ['Jackal', 'jackal'],
  ['Coyote', 'coyote'], ['Bison', 'bison'], ['Buffalo', 'buffalo'], ['Ibex', 'ibex'], ['Gazelle', 'gazelle'],
  ['Flamingo', 'flamingo'], ['Swan', 'swan'], ['Pelican', 'pelican'], ['Heron', 'heron'], ['Stork', 'stork'],
  ['Lobster', 'lobster'], ['Jellyfish', 'jellyfish'], ['Starfish', 'starfish'], ['Seahorse', 'seahorse'], ['Ray', 'ray'],
  ['Golem', 'golem'], ['Elemental', 'elemental'], ['Wisp', 'wisp'], ['Shade', 'shade'], ['Gargoyle', 'gargoyle']
];
moreWild.forEach(([n, s], i) => {
  add('wildlife', [{
    entity_id: 'wild_' + s, name: n, category: 'wildlife', sprite_ref: 'wild_' + s + '_01',
    stats: { hp: 50 + i * 5, speed: 2, rarity: rar[i % 4] },
    behavior_tree: ['roam', 'hunt', 'sleep'], interactions: ['hunt', 'flee']
  }]);
});

const moreFlora = [
  ['Cedar', 'cedar'], ['Maple', 'maple'], ['Cherry Blossom', 'cherry'], ['Sequoia', 'sequoia'], ['Baobab', 'baobab'],
  ['Kelp', 'kelp'], ['Coral', 'coral'], ['Algae', 'algae'], ['Clover', 'clover'], ['Thistle', 'thistle'],
  ['Nettle', 'nettle'], ['Peppermint', 'peppermint'], ['Ginseng', 'ginseng'], ['Aloe', 'aloe'], ['Cacao', 'cacao']
];
moreFlora.forEach(([n, s], i) => {
  add('flora', [{
    entity_id: 'flora_' + s, name: n, category: 'flora', sprite_ref: 'flora_' + s + '_01',
    stats: { growth_time: 30 + i, yield: 3, rarity: rar[i % 4] },
    behavior_tree: ['grow', 'bloom'], interactions: ['harvest']
  }]);
});

const moreStruct = [
  ['Ziggurat', 'ziggurat'], ['Pagoda', 'pagoda'], ['Amphitheater', 'amphitheater'], ['Circus', 'circus'],
  ['Bazaar', 'bazaar'], ['Caravanserai', 'caravanserai'], ['Mint', 'mint'], ['Armory', 'armory'],
  ['Apothecary Shop', 'apothecary_shop'], ['Cartographer Office', 'cartographer_office'],
  ['Clock Tower', 'clock_tower'], ['Bell Tower', 'bell_tower'], ['Sanctum', 'sanctum'], ['Crypt', 'crypt'],
  ['Dungeon', 'dungeon'], ['Throne Room', 'throne_room'], ['Great Hall', 'great_hall'], ['War Room', 'war_room'],
  ['Embassy Annex', 'embassy_annex'], ['Customs House', 'customs_house']
];
moreStruct.forEach(([n, s], i) => {
  add('structures', [{
    entity_id: 'struct_' + s, name: n, category: 'structure', sprite_ref: 'struct_' + s + '_01',
    stats: { durability: 200 + i * 10, capacity: 5 + i, rarity: rar[i % 4] },
    behavior_tree: ['build', 'occupy'], interactions: ['enter', 'repair']
  }]);
});

r.total_entities = Object.values(r.categories).reduce((a, c) => a + c.items.length, 0);
fs.writeFileSync(p, JSON.stringify(r, null, 2));
console.log('total', r.total_entities);
Object.entries(r.categories).forEach(([k, v]) => console.log(k, v.count));
