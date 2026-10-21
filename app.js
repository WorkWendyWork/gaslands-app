// Rules data (vehicles, weapons, upgrades, sponsors, scenarios, core rules) comes from `db` in data.js.

let currentPhase = 1;
let currentRound = 1;
let maxCans = 50;
let currentScenario = 'death_race';
let votesEnabled = false;
let votesVariant = 'peer';
let currentTeamIndex = 0;
let currentVehicleIndex = 0;
let lastAttackRolls = [];
let firstRun = false;        // no saved game: start with How to Play
let noVehiclePrompt = false;  // the turn flow is showing the empty-roster message

let teams = [];

const WEIGHTS = ['Lightweight', 'Middleweight', 'Heavyweight'];

// ---------- Data helpers ----------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sponsorOf(team) {
  return db.sponsors.find(s => s.id === (team && team.sponsor)) || null;
}

function sponsorLabel(team) {
  const s = sponsorOf(team);
  return s ? s.name : 'Independent';
}

function hasPerk(team, perkName) {
  const s = sponsorOf(team);
  return !!(s && s.perks.some(p => p.name === perkName));
}

function wipeoutAt(team) {
  const s = sponsorOf(team);
  return (s && s.wipeout_at) || 6;
}

function vehicleType(id) {
  return db.vehicles.find(t => t.id === id);
}

function findItem(id) {
  const w = db.weapons.find(x => x.id === id);
  if (w) return { kind: 'weapon', data: w };
  const u = db.upgrades.find(x => x.id === id);
  if (u) return { kind: 'upgrade', data: u };
  return null;
}

function findPerk(id) {
  return db.perks.find(p => p.id === id) || null;
}

// Perks a team may buy: those in its sponsor's perk classes. Independents get none.
function perkAllowed(perk, team) {
  const s = sponsorOf(team);
  return !!(s && perk && s.perk_classes.includes(perk.perk_class));
}

function itemText(item) {
  return item.special !== undefined ? item.special : (item.description || '');
}

function itemAmmo(item, team) {
  const m = itemText(item).match(/Ammo (\d+)/);
  if (!m) return null;
  let n = parseInt(m[1]);
  if (n === 3 && item.attack_dice !== undefined && hasPerk(team, 'Well Stocked')) n = 4;
  return n;
}

function itemCost(item, team) {
  if (item.id === 'nitro' && hasPerk(team, 'N2O Addict')) return Math.ceil(item.cost / 2);
  if (item.id === 'extra_crew' && hasPerk(team, 'Crew Quarters')) return Math.ceil(item.cost / 2);
  return item.cost;
}

function itemSlots(item, team, v) {
  if (item.id === 'ram' && hasPerk(team, 'Spiked Fist')) return 0;
  if (item.category === 'dropped' && v && /Airborne/.test(v.special)) return 0; // Bombs Away
  return item.build_slots;
}

function currentTeam() {
  return teams[currentTeamIndex];
}

function currentVehicle() {
  const t = currentTeam();
  return t && t.roster[currentVehicleIndex];
}

// Build a vehicle record from a vehicle type in the database.
function makeVehicle(typeId, name) {
  const t = vehicleType(typeId) || vehicleType('car');
  return {
    name: name || t.name,
    typeId: t.id,
    type: t.name,
    weight: t.weight,
    special: t.special,
    gear: 1,
    hazard: 0,
    hull: t.hull,
    maxHull: t.hull,
    handling: t.handling,
    maxGear: t.max_gear,
    crew: t.crew,
    slots: t.slots,
    cost: t.cost,
    onFire: false,
    gatesPassed: 0,
    scenarioPoints: 0,
    items: [],
    perks: []
  };
}

// Recompute stats and cost from the base type plus equipped items. Keeps damage already taken.
function recalcVehicle(v, team) {
  const t = vehicleType(v.typeId);
  if (!t) return;
  const count = id => v.items.filter(i => i.id === id).length;
  let maxHull = t.hull + 2 * count('armour') + 2 * count('microplate') - 2 * count('prison_car');
  let maxGear = t.max_gear - count('tank_tracks');
  if (count('nuclear_engine')) maxGear = Math.min(6, maxGear + 2);
  let cost = t.cost;
  v.items.forEach(i => { const it = findItem(i.id); if (it) cost += itemCost(it.data, team); });
  (v.perks || []).forEach(id => { const p = findPerk(id); if (p) cost += p.cost; });
  if (count('prison_car')) cost = Math.max(5, cost);
  const slotsBonus = v.items.reduce((acc, i) => { const it = findItem(i.id); return acc + ((it && it.data.slots_bonus) || 0); }, 0);

  const damage = (v.maxHull || t.hull) - v.hull;
  v.maxHull = maxHull;
  v.hull = Math.max(0, maxHull - damage);
  v.maxGear = maxGear;
  v.gear = Math.min(v.gear, maxGear);
  v.handling = t.handling + count('tank_tracks');
  v.crew = t.crew + count('extra_crew');
  v.slots = t.slots + slotsBonus;
  v.cost = cost;
  v.type = t.name;
  v.weight = t.weight;
  v.special = t.special;
}

function usedSlots(v, team) {
  return v.items.reduce((acc, i) => { const it = findItem(i.id); return acc + (it ? itemSlots(it.data, team, v) : 0); }, 0);
}

function newTeam(name, sponsorId) {
  return { teamName: name, sponsor: sponsorId || 'none', votes: 0, roster: [] };
}

// ---------- Select population ----------

function sponsorOptions(selected) {
  return `<option value="none"${selected === 'none' ? ' selected' : ''}>Independent (no sponsor)</option>` +
    db.sponsors.map(s => `<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${esc(s.name)} (${s.perk_classes.join(', ')})</option>`).join('');
}

function fillScenarioSelect(select) {
  const groups = {};
  db.scenarios.forEach(s => { (groups[s.category] = groups[s.category] || []).push(s); });
  select.innerHTML = Object.keys(groups).map(cat =>
    `<optgroup label="${esc(cat)}">` + groups[cat].map(s => `<option value="${s.id}">${esc(s.name)} (p.${s.page})</option>`).join('') + '</optgroup>'
  ).join('') + '<optgroup label="Other"><option value="free_play">Free Play / Custom</option></optgroup>';
}

function chassisOptions(selected) {
  const opt = t => `<option value="${t.id}"${t.id === selected ? ' selected' : ''}>${esc(t.name)} (${t.cost} Cans)${t.restricted ? ' [Restricted]' : ''}</option>`;
  return `<optgroup label="Basic Vehicles">${db.vehicles.filter(t => !t.advanced).map(opt).join('')}</optgroup>` +
    `<optgroup label="Advanced Vehicles">${db.vehicles.filter(t => t.advanced).map(opt).join('')}</optgroup>`;
}

function typeInfoHtml(typeId) {
  const t = vehicleType(typeId);
  if (!t) return '';
  return `<b>${esc(t.name)}</b> · ${t.weight} · ${t.cost} Cans<br>Hull ${t.hull} · Handling ${t.handling} · Max Gear ${t.max_gear} · Crew ${t.crew} · Slots ${t.slots}` +
    `<br><span style="color:#ccc;">${t.special ? 'Special: ' + esc(t.special) : 'No special rules.'}</span>`;
}

// Weapons and upgrades this team may buy, grouped, for a vehicle's add-item select.
function itemOptions(team, v, selected) {
  const allowed = it => (!it.mishkin_only || team.sponsor === 'mishkin') && (!it.sponsor_only || it.sponsor_only === team.sponsor);
  const sl = it => { const n = itemSlots(it, team, v); return `${n} slot${n === 1 ? '' : 's'}`; };
  const sel = it => it.id === selected ? ' selected' : '';
  const wOpt = w => `<option value="${w.id}"${sel(w)}>${esc(w.name)} (${w.attack_dice}D6, ${sl(w)}, ${itemCost(w, team)} C)</option>`;
  const uOpt = u => `<option value="${u.id}"${sel(u)}>${esc(u.name)} (${sl(u)}, ${itemCost(u, team)} C)</option>`;
  const group = (label, list, fn) => list.length ? `<optgroup label="${label}">${list.map(fn).join('')}</optgroup>` : '';
  return group('Vehicle Weapons', db.weapons.filter(w => w.category === 'vehicle' && allowed(w)), wOpt) +
    group('Crew Weapons', db.weapons.filter(w => w.category === 'crew' && allowed(w)), wOpt) +
    group('Dropped Weapons', db.weapons.filter(w => w.category === 'dropped' && allowed(w)), wOpt) +
    group('Upgrades', db.upgrades.filter(allowed), uOpt);
}

function itemInfoHtml(id, team) {
  const it = findItem(id);
  if (!it) return '';
  const d = it.data, ammo = itemAmmo(d, team);
  const parts = [];
  if (it.kind === 'weapon') parts.push(`Range ${esc(d.range)} · ${d.attack_dice}D6`);
  if (ammo) parts.push(`Ammo ${ammo}`);
  if (d.tags && d.tags.length) parts.push(d.tags.join(', '));
  return parts.join(' · ') + (itemText(d) ? `<br><span style="color:#ccc;">${esc(itemText(d))}</span>` : '');
}

// ---------- Turn flow ----------
// Each step explains what to do at the table for someone who has never played.
// Game terms in the text become tappable links to GLOSSARY (see linkTerms).

let wipeoutRef = null;      // {ti, vi} of the vehicle resolving a Wipe Out
let lastHits = 0;           // hits from the last attack roll, carried to the Evade step
let lastWeaponId = null;    // weapon used in the last attack, for Blast and Fire
let lastCancelled = 0;      // hits cancelled by the last Evade roll
let flowHistory = [];       // previous steps, for the Back button
let currentNodeId = null;

const GLOSSARY = {
  'Round': 'One full cycle of play. A round has 6 Gear Phases, played in order from 1 to 6. Then a new round starts. The scenario says when the game ends.',
  'Gear Phase': 'One of the 6 parts of a round. In Gear Phase 3, only vehicles currently in Gear 3 or higher get to activate, so faster vehicles act more often.',
  'Gear': 'A vehicle\'s current speed, from 1 up to its Max Gear. Every vehicle starts the game in Gear 1 and keeps its Gear between rounds. Gear changes when you spend a Shift on it (which also gives 1 Hazard Token), and drops back to 1 after a Wipe Out or being Wrecked.',
  'Max Gear': 'The highest Gear a vehicle type can reach. Shown on the vehicle in the Garage.',
  'Activation': 'A vehicle\'s turn. It has three steps, always in this order: Movement Step, Attack Step, Wipeout Step. Each vehicle activates at most once per Gear Phase, and a player who has a waiting vehicle must activate one.',
  'Movement Step': 'The first part of an activation: choose a template, roll Skid Dice, then move the vehicle.',
  'Attack Step': 'The second part of an activation: the vehicle may attack with its weapons, up to its Crew value in attacks.',
  'Wipeout Step': 'The last part of an activation: every vehicle on the table with 6 or more Hazard Tokens Wipes Out, not just the one that moved.',
  'Pole Position': 'The player who activates first in each Gear Phase. The scenario says who starts with it (usually a roll-off) and when it passes on. In many scenarios it passes clockwise at the end of every Gear Phase.',
  'Hull': 'How much damage a vehicle can take. Each hit that gets through removes 1 Hull Point. At 0 Hull the vehicle is Wrecked.',
  'Handling': 'The most Skid Dice the vehicle may roll when it moves. Higher Handling means better control.',
  'Crew': 'How many attacks the vehicle may make in its Attack Step. Every crew member carries a Handgun.',
  'Hazard Token': 'A marker showing a vehicle is losing control. You gain them from changing Gear, Hazardous templates, bad Skid Dice, Collisions and some weapons. A vehicle with 6 or more at a Wipeout Step (8 for Rusty\'s Bootleggers) Wipes Out.',
  'Wipe Out': 'What happens when a vehicle has too many Hazard Tokens: it makes a Flip check, then drops to Gear 1 and loses all its Hazard Tokens, and the next player clockwise turns it to face any direction.',
  'Flip': 'A bad Wipe Out. Roll a D6: if it is lower than the vehicle\'s Gear, it flips. It takes 2 hits that cannot be evaded and makes a forced move with a Medium Straight directly forward, ignoring anything in the way.',
  'Template': 'The shaped pieces used to move and measure: Straights (Short, Medium, Long), curves (Gentle, Turn, Hard, Hairpin), side-steps (Veer, Swerve), plus the Slide and Burst templates. The Gears each movement template may be used in are shaded on it.',
  'Trivial': 'A template that is easy at the vehicle\'s current Gear (a Shift icon under that Gear on the template). Using it gives 1 bonus Shift, as if you had rolled one.',
  'Hazardous': 'A template that is risky at the vehicle\'s current Gear (a hazard icon under that Gear on the template). Choosing it gives 1 Hazard Token straight away.',
  'Skid Dice': 'Special six-sided dice rolled when moving. With normal dice: 1 = Hazard, 2 = Spin, 3 = Slide, 4 to 6 = Shift. You may roll anything from none up to the vehicle\'s Handling, all at once.',
  'Shift': 'A good Skid Dice result. Spend each one to cancel one Hazard, Spin or Slide result, remove 1 Hazard Token, or change Gear up or down by 1 (which gives 1 Hazard Token). You may also throw it away unused.',
  'Spin': 'A Skid Dice result: gain 1 Hazard Token, and after moving, turn the vehicle on the spot by up to 90 degrees either way. Extra Spins only add Hazard Tokens.',
  'Slide': 'A Skid Dice result: gain 1 Hazard Token, slot the Slide template into the notched arrow on the movement template, and end the move at the far end of the Slide template, side-on. Extra Slides only add Hazard Tokens.',
  'Push It': 'After rolling Skid Dice, take 1 Hazard Token to re-roll any of them (you choose which). Once per Movement Step.',
  'Final Position': 'Where the vehicle ends its move: at the far end of the template, with its rear edge centred on the end.',
  'Pivot': 'Turn the vehicle on the spot around its centre.',
  'Obstruction': 'Anything a vehicle can crash into: other vehicles, obstacles and wrecks.',
  'Collision': 'When a vehicle runs into another vehicle, an obstacle or a wreck. The moving vehicle stops where it first touches. Each side chooses Smash Attack or Evade, then every vehicle involved gains Hazard Tokens.',
  'Smash Attack': 'Ramming in a Collision. Roll Smash dice (the number depends on the angle, the Gears and the weights); each 4+ is a hit and a 6 counts as 2 hits. A vehicle that Smashes cannot Evade.',
  'Evade': 'Dodging. Roll one die for each point of your current Gear; each 6 cancels one hit. A target rolls once against all the hits from one vehicle\'s Attack Step. In a Collision, only a vehicle that chose Evade may roll.',
  'Head-On': 'A Collision where both vehicles are hit on their front edges. Each rolls Smash dice equal to both Gears added together.',
  'T-Bone': 'A Collision where either vehicle is hit on its side. Each rolls Smash dice equal to its own Gear.',
  'Tailgate': 'A Collision where either vehicle is hit on its rear. Smash dice = the faster Gear minus the slower one. If the vehicle in front is going faster, both must Evade.',
  'Weight': 'Every vehicle is Lightweight, Middleweight or Heavyweight. In a Smash Attack the heavier vehicle gets +2 dice per class heavier, and the lighter one loses 1 die per class lighter. Heavier vehicles also explode harder.',
  'Attack dice': 'The dice a weapon rolls when it attacks (shown as 3D6 for three dice). Each 4 or more is a hit; a 6 is a Critical Hit.',
  'Critical Hit': 'An attack die that rolls a natural 6. It counts as 2 separate hits, even when the target is in Cover.',
  'Cover': 'If the shooting template crosses a vehicle, obstacle or wreck before it reaches the target, the target is in Cover: each die needs a 5 or 6 to hit instead of 4+. Indirect weapons ignore Cover.',
  'Range': 'How far a weapon reaches, measured with templates: Short, Medium and Long use the Straight of that name, and Double is a Medium and a Long Straight end to end. If any part of the template, placed in the weapon\'s arc of fire, can touch the target, it is in range.',
  'Arc of Fire': 'The direction a weapon can shoot. Front: the shooting template goes straight out from the front edge. Rear: from the rear edge. Side: straight out from either side. Turrets and crew weapons (360) can point any way.',
  'Distracted': 'A vehicle touching another vehicle, an obstacle or a wreck at the start of its Attack Step is Distracted: it cannot shoot or use dropped weapons this turn.',
  'Crew Fired': 'Weapons used by the crew, such as Handguns, Grenades and Molotov Cocktails. They can shoot in any direction and need no build slots.',
  'Handgun': 'Every vehicle has as many Handguns as it needs: 1 attack die, Medium range, any direction. Each one still uses up one of the vehicle\'s attacks.',
  'Dropped': 'A weapon left behind the vehicle, like mines, oil or caltrops. Place its template behind the vehicle; vehicles that move over it suffer its effect.',
  'Ammo': 'Some weapons and upgrades have a limited number of uses. Spend 1 Ammo token each time you use it; at 0 it cannot be used. Leftover Ammo makes a Wrecked vehicle more likely to explode.',
  'Wrecked': 'At 0 Hull a vehicle is Wrecked: it skids to a halt (a forced Short Straight forward), drops to Gear 1 with no Hazard Tokens, makes an Explosion check, then is turned upside down and stays as a wreck (an obstacle you can smash through). Its owner gains 1 Audience Vote. If it was Wrecked in a Collision, remove it from the table instead.',
  'Explosion': 'When a vehicle is Wrecked, roll a D6 and add its remaining Ammo tokens. On 6 or more it explodes: it attacks every vehicle within Medium range, in all directions, with 2D6 (Lightweight), 4D6 (Middleweight) or 6D6 (Heavyweight) with Blast, then is removed. Explosion hits can be evaded.',
  'Audience Votes': 'Bonus points the crowd gives for spectacular play, spent on special actions such as re-loading or re-spawning. See Rules, Audience Votes. Optional.',
  'Cans': 'The money used to build a team. Every vehicle, weapon, upgrade and perk costs Cans; the can cap is the most each player may spend.',
  'Sponsor': 'The backer your team drives for. It gives special rules (sponsor perks) and decides which perks you may buy.',
  'Perk': 'A special skill bought for a vehicle\'s driver from your sponsor\'s perk classes.',
  'On Fire': 'A vehicle damaged by a Fire weapon catches fire. It loses 1 Hull at the start of each activation until it has no Hazard Tokens.',
  'Blast': 'A weapon rule: every hit that is not evaded also gives the target 1 Hazard Token.',
  'Splash': 'A weapon rule: attack every vehicle under the template separately, including your own.',
  'Indirect': 'A weapon rule: ignores Cover and scenery between you and the target.',
  'D6': 'A normal six-sided die. "4D6" means roll four of them.',
  'Obstacle': 'Scenery that blocks movement. Walls, buildings and rocks are Heavyweight; barrels, barriers and lampposts Middleweight. Tall ones also block shooting. Hitting one is always Head-On, with the obstacle in Gear 0.',
  'Rough': 'Ground such as dirt or gravel. If any part of a move touches it, gain 1 Hazard Token.',
  'Treacherous': 'Ground such as ice, oil or water. If any part of a move touches it, gain 2 Hazard Tokens.',
  'Road': 'If the whole template and the Final Position are on Road, you may remove 1 Hazard Token.',
  'Scenario': 'The mission you are playing. It explains how to set up the table, who gets Pole Position, and how to win.',
  'Touch It, Use It': 'Once you touch a movement template, you must use it. You may not try several templates to find the best one, and you may not measure moves in advance.',
  'Reverse': 'A vehicle in Gear 1 may move backwards: place any template allowed in Gear 1 against its rear edge instead of its front.'
};

// Other spellings that link to the same glossary entry.
const GLOSSARY_ALIASES = {
  'Gear Phases': 'Gear Phase', 'Rounds': 'Round', 'Hazard Tokens': 'Hazard Token', 'Hazards': 'Hazard Token',
  'Wipes Out': 'Wipe Out', 'Flips': 'Flip', 'templates': 'Template', 'template': 'Template', 'Templates': 'Template',
  'Skid Die': 'Skid Dice', 'Shifts': 'Shift', 'Collisions': 'Collision', 'Smash': 'Smash Attack', 'Evades': 'Evade',
  'Lightweight': 'Weight', 'Middleweight': 'Weight', 'Heavyweight': 'Weight', 'Critical Hits': 'Critical Hit',
  'range': 'Range', 'arc of fire': 'Arc of Fire', 'crew weapon': 'Crew Fired', 'crew weapons': 'Crew Fired',
  'Handguns': 'Handgun', 'dropped weapons': 'Dropped', 'Wreck': 'Wrecked', 'wreck': 'Wrecked', 'explodes': 'Explosion',
  'Audience Vote': 'Audience Votes', 'Perks': 'Perk', 'perks': 'Perk', 'obstacle': 'Obstacle', 'obstacles': 'Obstacle',
  'obstruction': 'Obstruction', 'obstructions': 'Obstruction',
  'Hull Point': 'Hull', 'Hull Points': 'Hull', 'activates': 'Activation', 'activation': 'Activation', 'activate': 'Activation',
  'scenario': 'Scenario', 'reverse': 'Reverse'
};

function glossaryKey(word) {
  return GLOSSARY[word] ? word : GLOSSARY_ALIASES[word];
}

// Turns the first mention of each game term in `root` into a button that explains it.
function linkTerms(root) {
  const words = Object.keys(GLOSSARY).concat(Object.keys(GLOSSARY_ALIASES)).sort((a, b) => b.length - a.length);
  const re = new RegExp('(?<![\\w-])(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\w-])', 'g');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement.closest('button, select, option, label, input, textarea, .flow-roll, .no-terms')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const used = new Set();
  nodes.forEach(node => {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0, m, changed = false;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const key = glossaryKey(m[1]);
      if (!key || used.has(key)) continue;
      used.add(key);
      frag.append(text.slice(last, m.index));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'term';
      b.textContent = m[1];
      b.onclick = () => showTerm(key);
      frag.append(b);
      last = m.index + m[1].length;
      changed = true;
    }
    if (changed) { frag.append(text.slice(last)); node.replaceWith(frag); }
  });
}

function showTerm(key) {
  const box = document.getElementById('term-box');
  box.innerHTML = `<div class="row" style="justify-content:space-between; align-items:flex-start;"><div><b style="color:var(--yellow);">${esc(key)}</b><br>${esc(GLOSSARY[key])}</div><button class="x-btn" style="background:#3b3b3b;" onclick="document.getElementById('term-box').style.display='none'" aria-label="Close">✕</button></div>`;
  box.style.display = 'block';
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showGlossary() {
  showReference('<b>GLOSSARY</b><br><span class="muted small">Every game term used in the turn guide.</span><br><br>' +
    Object.keys(GLOSSARY).sort().map(k => card(esc(k), esc(GLOSSARY[k]))).join(''));
}

function tip(html) { return `<div class="flow-tip">${html}</div>`; }
function warn(html) { return `<div class="flow-warn">${html}</div>`; }
function steps(list) { return `<ol class="flow-steps">${list.map(x => `<li>${x}</li>`).join('')}</ol>`; }
function rollD6(n) { return Array.from({ length: Math.max(0, n) }, () => Math.floor(Math.random() * 6) + 1); }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
function diceCount(n, kind) { return `${n} ${kind} ${n === 1 ? 'die' : 'dice'}`; }

function allVehicles() {
  const out = [];
  teams.forEach((t, ti) => t.roster.forEach((v, vi) => out.push({ t, v, ti, vi })));
  return out;
}

function targetOptions() {
  const cur = currentVehicle();
  return allVehicles().filter(x => x.v.hull > 0 && x.v !== cur)
    .map(x => `<option value="${x.ti}:${x.vi}">${esc(x.t.teamName)}: ${esc(x.v.name)} (Gear ${x.v.gear}, Hull ${x.v.hull})</option>`).join('');
}

function refFromValue(val) {
  const [ti, vi] = String(val).split(':').map(Number);
  const t = teams[ti];
  return t && t.roster[vi] ? { ti, vi, t, v: t.roster[vi] } : null;
}

function templatesForGear(g) {
  const triv = db.templates.filter(t => t.trivial.includes(g)).map(t => t.name);
  const haz = db.templates.filter(t => t.hazardous.includes(g)).map(t => t.name);
  return `<div class="flow-box"><b>In Gear ${g}:</b><br>⚡ Trivial (free Shift): <b>${triv.join(', ') || 'none'}</b><br>⚠️ Hazardous (+1 Hazard Token): <b>${haz.join(', ') || 'none'}</b></div>`;
}

function statusLine(v) {
  return `<div class="flow-status">Gear <b>${v.gear}</b> · Hazards <b>${v.hazard}</b> · Hull <b>${v.hull}/${v.maxHull}</b></div>`;
}

// Weapons the active vehicle can attack with: equipped weapons plus one Handgun per crew member.
function flowWeapons(v) {
  const list = v.items.map((it, idx) => ({ it, idx, w: db.weapons.find(w => w.id === it.id) })).filter(x => x.w);
  const handgun = db.weapons.find(w => w.id === 'handgun');
  if (handgun && !list.some(x => x.w.id === 'handgun')) list.push({ it: { id: 'handgun', facing: '360', ammo: null }, idx: -1, w: handgun, crew: v.crew });
  return list;
}

const rulesData = {
  "How_To_Play": {
    noVehicle: true,
    category: "setup",
    title: "How to Play",
    render: () => ({
      html: `<p>Gaslands is a game of car combat. Each player controls a team of toy cars that race, shoot and ram each other on a tabletop. This guide walks you through every step, so you don't need to know the rules.</p>
        <b>You will need</b>
        <ul class="flow-steps"><li>A toy car for each vehicle (build your teams in the Garage tab).</li><li>The movement templates (Straights, curves and the Slide template).</li><li>Skid Dice, or normal six-sided dice (D6) instead.</li><li>Plenty of normal D6 dice for shooting.</li><li>Tokens or coins to mark Hazard Tokens on each car.</li></ul>
        <b>How a round works</b>
        ${steps([
          'A Round is split into 6 Gear Phases, played in order from 1 to 6.',
          'In each Gear Phase, every vehicle whose Gear is at least that number gets one turn, called an activation. Fast vehicles act in more phases, slow ones in fewer.',
          'Players take it in turns to activate one of their waiting vehicles, starting with the player who has Pole Position.',
          'In its activation a vehicle moves (Movement Step), shoots (Attack Step), then everyone checks for lost control (Wipeout Step).',
          'When no vehicle is waiting, move on to the next Gear Phase. After Gear Phase 6, a new round begins.'
        ])}
        ${tip('Tap any <u>underlined</u> word to see what it means. Use the Back button if you tap the wrong thing.')}`,
      options: [
        { text: "Set Up a New Game", next: "Game_Setup" },
        { text: "Go to the Current Gear Phase", next: "Turn_Start" }
      ]
    })
  },
  "Game_Setup": {
    noVehicle: true,
    category: "setup",
    title: "Game Setup",
    render: () => ({
      html: `<p>Decide these together before you start. You can change them later in Settings.</p>
        <label class="field-label" for="can-input">Can cap: the most each player may spend on their team</label>
        <input type="number" id="can-input" value="${maxCans}" min="0">
        ${tip('Cans are the money for building teams. For your first games the rulebook suggests giving each player one Car and one Buggy, each with a front-mounted Machine Gun. Build each team in the Garage tab and keep its total at or under this number.')}
        <label class="field-label" for="scenario-select" style="margin-top:12px;">Scenario: the mission you are playing</label>
        <select id="scenario-select">${''}</select>
        ${tip('A scenario explains how to set up the table and how to win. Death Race is a good first game. Free Play means you agree your own goal.')}
        <label style="display:flex; gap:8px; align-items:center; margin-top:12px;"><input type="checkbox" id="votes-toggle"${votesEnabled ? ' checked' : ''}> Use Audience Votes</label>
        ${tip('Audience Votes are bonus points the crowd gives for spectacular driving, spent on special actions. Leave them off for your first game.')}`,
      options: [
        { text: "Save and Set Up the Table", action: "saveGameSetup" }
      ],
      after: () => { const sc = document.getElementById('scenario-select'); fillScenarioSelect(sc); sc.value = currentScenario; }
    })
  },
  "Deployment": {
    noVehicle: true,
    category: "setup",
    title: "Set Up the Table",
    render: () => {
      const sc = db.scenarios.find(x => x.id === currentScenario);
      const scen = sc
        ? `<p>Scenario: <b>${esc(sc.name)}</b> (rulebook page ${sc.page}${sc.rounds ? `, lasts ${sc.rounds} rounds` : ''}).</p>` +
          [['Teams', sc.teams], ['Table setup', sc.setup], ['Placing vehicles', sc.deployment], ['How to win', sc.victory]]
            .filter(([, val]) => val).map(([label, val]) => card(label, renderRules(val))).join('')
        : `<p>Free Play: put some scenery on the table, agree a goal (for example, last team driving wins), and place each team's vehicles at opposite ends.</p>`;
      return {
        html: scen + steps([
          'Every vehicle starts in Gear 1, with no Hazard Tokens and full Hull.',
          'Each player rolls a D6. The highest roll gets Pole Position: they activate first in every Gear Phase. ' + poleRule(sc),
          'When you are ready, reset all vehicles below and start Round 1.'
        ]),
        options: [
          { text: "Reset All Vehicles and Start Round 1", action: "startNewGame" },
          { text: "Start Without Resetting", next: "Turn_Start" }
        ]
      };
    }
  },
  "Turn_Start": {
    noVehicle: true,
    category: "movement",
    title: "Gear Phase: Who Goes Next",
    render: () => {
      const waiting = [], done = [], slow = [];
      allVehicles().forEach(x => {
        if (x.v.hull <= 0) return;
        if (x.v.gear < currentPhase) slow.push(x);
        else if (x.v.activated) done.push(x);
        else waiting.push(x);
      });
      const name = x => `${esc(x.t.teamName)}: ${esc(x.v.name)}`;
      if (!allVehicles().length) {
        return { html: '<p>Nobody has any vehicles yet. Build a team for each player in the Garage tab first.</p>', options: [{ text: "Go to Garage", fn: () => switchTab('garage') }, { text: "How to Play", next: "How_To_Play", style: 'btn-grey' }] };
      }
      let html = `<p><b>Round ${currentRound} · Gear Phase ${currentPhase} of 6.</b> In this Gear Phase, every vehicle in Gear ${currentPhase} or higher gets one activation.</p>`;
      if (waiting.length) {
        html += steps([
          'The player with Pole Position picks one of their waiting vehicles and activates it. Tap it below.',
          'Then the next player clockwise activates one of theirs, and so on around the table. A player who has a waiting vehicle must activate one; a player with none passes.',
          'Check Gear at the moment you choose: a vehicle that changed Gear earlier in the round may now be waiting, and one that Wiped Out may no longer be.',
          `When no vehicles are waiting, tap ${currentPhase < 6 ? 'Next Gear Phase' : 'End Round'}.`
        ]);
      } else {
        html += `<div class="flow-box">No vehicles are waiting in this Gear Phase. Tap <b>${currentPhase < 6 ? 'Next Gear Phase' : 'End Round'}</b>.</div>`;
      }
      if (done.length) html += `<div class="small muted">Already activated: ${done.map(name).join(', ')}</div>`;
      if (slow.length) html += `<div class="small muted">Too slow for this phase: ${slow.map(x => `${name(x)} (Gear ${x.v.gear})`).join(', ')}</div>`;
      if (!waiting.length) html += tip(poleRule(db.scenarios.find(x => x.id === currentScenario)));
      const options = waiting.map(x => ({ text: `▶ ${x.t.teamName}: ${x.v.name} (Gear ${x.v.gear})`, fn: () => selectActivation(x.ti, x.vi) }));
      options.push({ text: currentPhase < 6 ? "Next Gear Phase" : "End Round", action: "nextGearPhase", style: waiting.length ? 'btn-grey' : '' });
      options.push({ text: "How to Play", next: "How_To_Play", style: 'btn-grey' });
      return { html, options };
    }
  },
  "Activation_Start": {
    category: "movement",
    title: "Start of Activation",
    render: (team, v) => {
      let html = `<p><b>${esc(team.teamName)}</b>'s <b>${esc(v.name)}</b> (${esc(v.type)}) is activating.</p>${statusLine(v)}
        <p>An activation has three steps, always in this order:</p>
        ${steps(['Movement Step: move the vehicle using a template.', 'Attack Step: shoot with its weapons.', 'Wipeout Step: check whether any vehicle has lost control.'])}`;
      if (v.onFire) html += warn(`<b>This vehicle is On Fire.</b> It loses 1 Hull now, at the start of its activation. The fire goes out once it has no Hazard Tokens.<br><button class="nav-btn btn-red btn-small" style="margin-top:8px;" onclick="flowFireDamage()">Take 1 Fire Damage</button>`);
      if (/Airwolf/.test(v.special)) html += tip('Airwolf: before moving, this vehicle may take 2 Hazard Tokens to turn on the spot by up to 90 degrees.');
      if (v.items.some(i => i.id === 'teleporter')) html += tip(`Experimental Teleporter: ${esc(findItem('teleporter').data.description)}`);
      return { html, options: [{ text: "Start Movement Step", next: "Move_Template" }, { text: "Pick a Different Vehicle", next: "Turn_Start", style: 'btn-grey' }] };
    }
  },
  "Move_Template": {
    category: "movement",
    title: "Movement 1 of 3: Choose a Template",
    render: (team, v) => {
      let html = `<p>Movement templates are the shaped pieces you move vehicles along: Straights (Short, Medium, Long), curves (Gentle, Turn, Hard, Hairpin) and side-steps (Veer, Swerve).</p>
        ${steps([
          `Look at the Gears shaded on each template. You may only use one that allows the vehicle's current Gear (Gear ${v.gear}).`,
          'Decide before you pick it up: under the Touch It, Use It rule, once you touch a template you must use it, and you may not measure moves in advance.',
          'Place it with one short end centred on the front edge of the vehicle, pointing where you want to go. Straights always go with the notched arrow at the far end. Don\'t move the vehicle yet.',
          v.gear === 1 ? 'In Gear 1 you may also Reverse: place a template allowed in Gear 1 against the rear edge instead, and move backwards.' : 'If the template is Hazardous in this Gear, take 1 Hazard Token now.'
        ])}
        ${templatesForGear(v.gear)}
        ${tip('Trivial templates are easy at this speed and give a bonus Shift. Hazardous ones are risky and give 1 Hazard Token as soon as you choose them. Other allowed templates have no bonus or penalty.')}
        ${tip('Your Gear does not change here. You can change it in the next step by spending a Shift.')}`;
      if (v.gear === 1 && currentRound === 1 && currentPhase === 1) html += tip('<b>First activation tip from the rulebook:</b> pick the Medium Straight (Trivial in Gear 1), roll no Skid Dice, and spend its bonus Shift to change up to Gear 2. That guarantees this vehicle another activation in Gear Phase 2.');
      if (hasPerk(team, 'Over the Limit')) html += warn('Rusty\'s Bootleggers (Over the Limit): Straights are never allowed; Veer is allowed and Trivial in any Gear.');
      return { html, options: [{ text: "Next: Roll Skid Dice", next: "Move_Skid" }] };
    }
  },
  "Move_Skid": {
    category: "movement",
    title: "Movement 2 of 3: Roll Skid Dice",
    render: (team, v) => ({
      html: `<p>Skid Dice show how well the driver handles the move. This vehicle's Handling is <b>${v.handling}</b>, so you may roll anywhere from 0 to ${v.handling} Skid Dice.</p>
        <div class="flow-box no-terms">
          <b>Shift</b> (4, 5 or 6 on a normal die): good. You will spend these in the next step.<br>
          <b>Hazard</b> (1): gain 1 Hazard Token.<br>
          <b>Spin</b> (2): gain 1 Hazard Token, and the vehicle turns up to 90° after moving.<br>
          <b>Slide</b> (3): gain 1 Hazard Token, and the vehicle slides sideways using the Slide template.
        </div>
        ${tip('More dice means more chances of Shifts, but also more chances of trouble. Roll 0 dice for a calm, safe move.')}
        <div class="flow-row"><label for="flow-skid-n">Dice to roll</label><input type="number" id="flow-skid-n" value="${v.handling}" min="0" max="${v.handling}"><button class="nav-btn btn-small" onclick="flowRollSkid()">Roll</button></div>
        <div id="flow-roll" class="flow-roll"></div>
        <p><b>Push It:</b> not happy with the roll? You may take 1 Hazard Token to re-roll any of the dice, once per Movement Step.${hasPerk(team, 'Virtuoso') ? ' Miyazaki (Virtuoso): the first Push It each activation costs no Hazard Token.' : ''}</p>`,
      options: [{ text: "Next: Finish the Move", next: "Move_Resolve" }]
    })
  },
  "Move_Resolve": {
    category: "movement",
    title: "Movement 3 of 3: Finish the Move",
    render: (team, v) => {
      let html = steps([
        '<b>Spend your Shifts</b> (plus the bonus Shift if the template was Trivial). Each Shift does one of these: cancel one Hazard, Spin or Slide result; remove 1 Hazard Token; change Gear up or down by 1 (this also gives 1 Hazard Token); or nothing.',
        '<b>Take Hazard Tokens:</b> 1 for each Hazard, Spin and Slide result you did not cancel.',
        '<b>Slide:</b> if you kept a Slide result, slot the Slide template into the notched arrow on the movement template. The vehicle will end at the far end of the Slide template instead, side-on. Coming off a Straight, you choose which way it faces.',
        '<b>Move the vehicle</b> to the far end of the template (or Slide template), with its rear edge centred on the end. This is its Final Position.',
        '<b>Crash check:</b> if the template or the Final Position overlaps another vehicle, an obstacle or a wreck, push the vehicle along the template only until it touches it. It stops there, and that is a Collision. Ignore anything the vehicle was already touching when this move started.',
        '<b>Spin:</b> if you kept a Spin result and the vehicle did not crash, turn it on the spot by up to 90 degrees either way. If the turn makes it touch something, that is a Collision too.',
        '<b>Check the ground:</b> if any part of the move touched Rough ground, take 1 Hazard Token; Treacherous ground, 2. If the whole move stayed on Road, you may remove 1 Hazard Token. A vehicle that goes over the table edge is out of the game.'
      ]) + `<p>Update Gear and Hazard Tokens here to match:</p>
        <div class="flow-adjust">
          <span>Gear <b>${v.gear}</b></span><button class="stat-btn" onclick="flowAdjust('gear', -1)" aria-label="Gear down">−</button><button class="stat-btn" onclick="flowAdjust('gear', 1)" aria-label="Gear up">+</button>
          <span style="margin-left:8px;">Hazards <b>${v.hazard}</b></span><button class="stat-btn" onclick="flowAdjust('hazard', -1)" aria-label="Remove hazard">−</button><button class="stat-btn" onclick="flowAdjust('hazard', 1)" aria-label="Add hazard">+</button>
        </div>
        <p><b>Did the vehicle crash into another vehicle, an obstacle or a wreck?</b></p>`;
      return { html, options: [{ text: "Yes: Resolve the Collision", next: "Check_Collision" }, { text: "No: Go to the Attack Step", next: "Attack_Intro" }] };
    }
  },
  "Check_Collision": {
    category: "combat",
    title: "Collision",
    render: (team, v) => {
      const hasRam = v.items.some(i => i.id === 'ram' || i.id === 'exploding_ram');
      let html = `<p>A Collision happens when vehicles touch, or a vehicle hits an obstacle. Resolve it now, before any shooting.</p>
        ${steps([
          '<b>Work out the angle</b> from where each vehicle was hit. Head-On: both are hit on their front edges. T-Bone: either is hit on its side. Tailgate: either is hit on its rear. A front corner counts as the front; a rear corner counts as the side. Hitting an obstacle or wreck is always Head-On, with it in Gear 0.',
          '<b>Each side chooses Smash or Evade</b>, starting with the vehicle that caused the crash, then clockwise. Smash: ram back with Smash dice, but you cannot dodge. Evade: don\'t ram, but you may roll Evade dice to dodge their Smash. Obstacles always Smash. In a Tailgate where the vehicle in front is faster, both must Evade.',
          '<b>Roll Smash dice</b> with the calculator below: each 4+ is a hit, a 6 counts as 2 hits. Then anyone who chose Evade rolls Evade dice (one per Gear, each 6 cancels a hit).',
          '<b>Apply damage to both sides at the same time</b>: 1 Hull Point per hit that got through.',
          '<b>Take Hazard Tokens:</b> every vehicle in the Collision gains 2 Hazard Tokens, or only 1 each if both chose Evade.',
          'A wreck or Destructible obstacle that was hit is removed afterwards, and the vehicle may carry on along its template. Otherwise it stays where it stopped, still touching, so it will be Distracted in its Attack Step.'
        ])}
        <div class="flow-box">
          <b>Smash dice calculator</b> for ${esc(v.name)} (Gear ${v.gear}, ${esc(v.weight)})
          <div class="flow-row"><label for="flow-angle">Angle</label><select id="flow-angle" onchange="flowSmashDice()"><option value="head">Head-On</option><option value="tbone">T-Bone</option><option value="tail">Tailgate</option><option value="obstacle">Obstacle</option></select></div>
          <div class="flow-row"><label for="flow-og">Other vehicle's Gear</label><input type="number" id="flow-og" value="1" min="0" max="6" onchange="flowSmashDice()"></div>
          <div class="flow-row"><label for="flow-ow">Other's weight</label><select id="flow-ow" onchange="flowSmashDice()">${WEIGHTS.map(w => `<option${w === v.weight ? ' selected' : ''}>${w}</option>`).join('')}</select></div>
          <div class="flow-row"><span id="flow-smash-n" class="grow"></span><button class="nav-btn btn-small" onclick="flowRollSmash()">Roll Smash</button></div>
          <div id="flow-roll" class="flow-roll"></div>
        </div>
        ${hasRam ? tip('This vehicle has a Ram: check its rules in the Garage for extra Smash dice on the facing it is mounted.') : ''}
        <div class="flow-adjust"><span>${esc(v.name)} Hazards <b>${v.hazard}</b></span><button class="nav-btn btn-small" onclick="flowAdjust('hazard', 2)">+2 Hazards</button><button class="nav-btn btn-small btn-grey" onclick="flowAdjust('hazard', 1)">+1 (both Evaded)</button></div>`;
      const options = [
        { text: "Apply Smash Damage to Another Vehicle", next: "Apply_Damage" },
        { text: "Collision Done: Go to the Attack Step", next: "Attack_Intro" }
      ];
      if (team.sponsor === 'slime') options.splice(1, 0, { text: "Slime: Use Pinball", next: "Check_Pinball" });
      return { html, options, after: flowSmashDice };
    }
  },
  "Check_Pinball": {
    category: "combat",
    title: "Slime: Pinball",
    render: () => {
      const s = db.sponsors.find(x => x.id === 'slime');
      const perk = s && s.perks.find(p => p.name === 'Pinball');
      return {
        html: `<p>${esc(perk ? perk.text : '')}</p>${tip('Side-to-side means the vehicles touched side against side.')}`,
        options: [{ text: "Make Another Movement Step", next: "Move_Template" }, { text: "Go to the Attack Step", next: "Attack_Intro" }]
      };
    }
  },
  "Attack_Intro": {
    category: "combat",
    title: "Attack Step",
    render: (team, v) => {
      const weapons = flowWeapons(v);
      const rows = weapons.map(x => {
        const ammo = x.it.ammo == null ? '' : ` · Ammo ${x.it.ammo}`;
        const facing = x.w.category === 'vehicle' ? (x.it.facing || 'Front') : 'any direction';
        const count = x.w.id === 'handgun' ? ' (as many as you like)' : '';
        return `<li><b>${esc(x.w.name)}${count}</b>: ${x.w.attack_dice}D6, ${esc(x.w.range)} range, ${esc(facing)}${ammo}</li>`;
      }).join('');
      let html = `<p>Now ${esc(v.name)} may attack. It has Crew ${v.crew}, so it may make <b>up to ${plural(v.crew, 'attack')}</b> this step. Each weapon may attack once; Handguns can fill any spare attacks.</p>
        <b>${esc(v.name)}'s weapons</b><ul class="flow-steps no-terms">${rows}</ul>
        ${steps([
          '<b>Distracted?</b> If the vehicle is touching another vehicle, an obstacle or a wreck right now, it is Distracted and cannot shoot. Go straight to the Wipeout Step.',
          '<b>Pick a target for each weapon.</b> Weapons may shoot at different vehicles. The target must be in the weapon\'s arc of fire: a Front weapon\'s template goes straight out from the front edge, Rear from the rear, Side from either side; 360 and crew weapons may point any way.',
          '<b>Check range</b> with the shooting template: Short, Medium and Long are the Straights of that name, Double is a Medium and a Long Straight end to end, Burst weapons use their Burst template. If any part of the template can touch the target, it is in range. You may measure before choosing.',
          '<b>Check Cover:</b> if the template crosses another vehicle, an obstacle or a wreck before reaching the target, the target is in Cover.',
          '<b>Roll all the weapons aimed at one target together</b>, then that target rolls one Evade against all of them.'
        ])}`;
      if (hasPerk(team, 'Televised Carnage')) html += tip('Rutherford (Televised Carnage): 6 or more hits in one Attack Step, before Evades, gains 1 Audience Vote.');
      return { html, options: [{ text: "Attack a Target", next: "Attack_Roll" }, { text: "No More Attacks: Go to the Wipeout Step", next: "Wipeout_Phase_Check" }] };
    }
  },
  "Attack_Roll": {
    category: "combat",
    title: "Roll to Hit",
    render: (team, v) => {
      const weapons = flowWeapons(v).filter(x => x.w.id !== 'handgun');
      const rows = weapons.map((x, k) => {
        const out = x.it.ammo != null && x.it.ammo <= 0;
        return `<label class="flow-check"><input type="checkbox" id="flow-w-${k}" data-idx="${x.idx}"${out ? ' disabled' : ''}> ${esc(x.w.name)} (${x.w.attack_dice}D6, ${esc(x.w.range)}${x.it.ammo != null ? `, Ammo ${x.it.ammo}` : ''})${out ? ' · out of Ammo' : ''}</label>`;
      }).join('');
      return {
        html: `<p>Tick every weapon you are firing at <b>one</b> target, and add any Handguns. ${esc(v.name)} may make up to ${plural(v.crew, 'attack')} in total this Attack Step.</p>
          ${rows || '<div class="muted small">No mounted weapons: use Handguns.</div>'}
          <div class="flow-row"><label for="flow-hg">Handguns (1D6 each, Medium range)</label><input type="number" id="flow-hg" value="${weapons.length ? 0 : v.crew}" min="0" max="${v.crew}"></div>
          <label class="flow-check"><input type="checkbox" id="flow-cover"> Target is in Cover</label>
          ${tip('Cover: the shooting template crosses another vehicle, an obstacle or a wreck before reaching the target. Then only 5s and 6s hit. Indirect weapons ignore Cover.')}
          <button class="nav-btn" style="margin-top:6px;" onclick="flowRollAttack()">Roll Attack Dice</button>
          <div id="flow-roll" class="flow-roll"></div>
          ${steps(['Each die that rolls 4 or more is a hit (5 or more if the target is in Cover).', 'A natural 6 is a Critical Hit and counts as 2 hits, even against Cover.', 'Weapons with Ammo use 1 token per attack; this app takes it off for you.'])}`,
        options: [{ text: "Next: Target Tries to Evade", next: "Attack_Evade" }, { text: "Back to Attack Step", next: "Attack_Intro", style: 'btn-grey' }]
      };
    }
  },
  "Attack_Evade": {
    category: "combat",
    title: "Target Evades",
    render: () => {
      const targets = targetOptions();
      if (!targets) return { html: '<p>There are no other vehicles to target. Add vehicles for the other players in the Garage.</p>', options: [{ text: "Back to Attack Step", next: "Attack_Intro" }] };
      return {
        html: `<p>The target now tries to dodge, once, against all the hits it just took. It rolls one Evade die for each point of its current Gear; every 6 cancels one hit. Faster vehicles are harder to hit.</p>
          <label class="field-label" for="flow-target">Target</label><select id="flow-target">${targets}</select>
          <div class="flow-row" style="margin-top:8px;"><label for="flow-hits">Hits to evade</label><input type="number" id="flow-hits" value="${lastHits}" min="0"><button class="nav-btn btn-small" onclick="flowRollEvade()">Roll Evade</button></div>
          <div id="flow-roll" class="flow-roll"></div>
          <div class="flow-row"><label for="flow-dmg">Damage to apply</label><input type="number" id="flow-dmg" value="${lastHits}" min="0"><button class="nav-btn btn-small btn-red" onclick="flowApplyAttack()">Apply</button></div>
          ${tip('Each hit that is not cancelled removes 1 Hull Point. Evade cancels plain hits first, then hits from weapons with special rules. Blast weapons give 1 Hazard Token per hit that gets through; Fire weapons set the target On Fire.')}`,
        options: [{ text: "Back to Attack Step", next: "Attack_Intro" }]
      };
    }
  },
  "Apply_Damage": {
    category: "combat",
    title: "Apply Damage",
    render: () => {
      const targets = targetOptions();
      return {
        html: targets
          ? `<p>Choose the vehicle that was hit and how many hits got through (after any Evade dice). Each hit removes 1 Hull Point.</p>
            <label class="field-label" for="flow-target">Vehicle hit</label><select id="flow-target">${targets}</select>
            <div class="flow-row" style="margin-top:8px;"><label for="flow-dmg">Hits</label><input type="number" id="flow-dmg" value="1" min="0"><button class="nav-btn btn-small btn-red" onclick="flowApplyDamage()">Apply</button></div>`
          : '<p>There are no other vehicles to damage.</p>',
        options: [{ text: "Go to the Attack Step", next: "Attack_Intro" }]
      };
    }
  },
  "Wipeout_Phase_Check": {
    category: "wipeout",
    title: "Wipeout Step",
    render: () => {
      const out = allVehicles().filter(x => x.v.hull > 0 && x.v.hazard >= wipeoutAt(x.t));
      let html = `<p>A vehicle with too many Hazard Tokens loses control and Wipes Out. This check covers <b>every vehicle on the table</b>, not just the one that moved. Vehicles Wipe Out at 6 or more Hazard Tokens (Rusty's Bootleggers at 8).</p>
        <p class="small muted">Resolve the active vehicle first, then the others in clockwise order of their players.</p>`;
      html += out.length
        ? `<div class="flow-warn">These vehicles Wipe Out now. Resolve each one:</div>`
        : `<div class="flow-box">No vehicle has enough Hazard Tokens to Wipe Out.</div>`;
      const options = out.map(x => ({ text: `Resolve Wipe Out: ${x.t.teamName}: ${x.v.name} (${x.v.hazard} Hazards)`, fn: () => { wipeoutRef = { ti: x.ti, vi: x.vi }; loadNode('Wipeout_Flip_Check'); }, style: 'btn-red' }));
      options.push({ text: "Finish This Activation", action: "finishActivation", style: out.length ? 'btn-grey' : '' });
      return { html, options };
    }
  },
  "Wipeout_Flip_Check": {
    category: "wipeout",
    title: "Wipe Out: Flip Check",
    render: () => {
      const w = wipeoutTarget();
      if (!w) return { html: '<p>Pick a vehicle to resolve from the Wipeout Step.</p>', options: [{ text: "Back to Wipeout Step", next: "Wipeout_Phase_Check" }] };
      const steps3 = steps([
        `<b>Flip check:</b> roll one D6. If it is lower than the vehicle's current Gear (Gear ${w.v.gear}), it Flips.`,
        'Whether it flips or not, it then drops to Gear 1 and loses all its Hazard Tokens.',
        'Finally, the next player clockwise turns the vehicle to face any direction they like. It has spun out of control.'
      ]);
      if (w.v.gear === 1) {
        return { html: `<p><b>${esc(w.v.name)}</b> Wipes Out.</p>${steps3}<div class="flow-box">It is in Gear 1, and a D6 can never roll lower than 1, so it cannot Flip.</div>`, options: [{ text: "Next: No Flip", next: "Wipeout_Flip_Pass" }] };
      }
      return {
        html: `<p><b>${esc(w.v.name)}</b> Wipes Out.</p>${steps3}<button class="nav-btn" onclick="flowRollFlip()">Roll Flip Check (D6)</button><div id="flow-roll" class="flow-roll"></div>`,
        options: [{ text: "It Flipped", next: "Wipeout_Flip_Fail", style: 'btn-red' }, { text: "No Flip", next: "Wipeout_Flip_Pass" }]
      };
    }
  },
  "Wipeout_Flip_Pass": {
    category: "wipeout",
    title: "Wipe Out: No Flip",
    render: () => {
      const w = wipeoutTarget();
      return {
        html: `<p>${w ? `<b>${esc(w.v.name)}</b> stays on its wheels.` : ''}</p>${steps(['Set it to Gear 1 and remove all its Hazard Tokens (the button below does this).', 'The next player clockwise turns the vehicle to face any direction.'])}`,
        options: [{ text: "Apply: Gear 1, No Hazards", action: "applyWipeoutPass" }]
      };
    }
  },
  "Wipeout_Flip_Fail": {
    category: "wipeout",
    title: "Wipe Out: Flip!",
    render: () => {
      const w = wipeoutTarget();
      const cage = w && w.v.items.some(i => i.id === 'roll_cage') || (w && /Roll Cage/.test(w.v.special));
      return {
        html: `<p>${w ? `<b>${esc(w.v.name)}</b> flips over!` : ''}</p>${steps([
          'It takes 2 hits that cannot be evaded (2 Hull Points).',
          'It makes a forced move: place a Medium Straight in front of it and move it to the end, straight forward, ignoring anything in the way. No Skid Dice. If it ends touching something, that is a Collision.',
          'Then set it to Gear 1 and remove all its Hazard Tokens.',
          'The next player clockwise turns the vehicle to face any direction.'
        ])}${cage ? tip('This vehicle has a Roll Cage, so it may ignore the 2 hits.') : ''}`,
        options: [
          { text: "Apply: 2 Hits, Gear 1, No Hazards", action: "applyWipeoutFlip", style: 'btn-red' },
          { text: "Roll Cage: Ignore the Hits", action: "applyWipeoutPass" }
        ]
      };
    }
  },
  "End_Activation": {
    category: "movement",
    title: "Activation Complete",
    render: (team, v) => ({
      html: `<p><b>${esc(v.name)}</b> has finished its activation.</p>${steps(['The next player clockwise who still has a waiting vehicle now activates one of theirs.', 'When nobody has a waiting vehicle, move on to the next Gear Phase.'])}`,
      options: [{ text: "Choose the Next Vehicle", next: "Turn_Start" }]
    })
  },
  "Round_End": {
    noVehicle: true,
    category: "movement",
    title: "End of Round",
    render: () => {
      const sc = db.scenarios.find(x => x.id === currentScenario);
      const list = ['Vehicles keep their Gear and Hazard Tokens into the next round.'];
      if (votesEnabled) list.push('Audience Votes: a player who starts the new round with no vehicles still in play gains 2 votes.');
      if (sc && sc.rounds) list.push(currentRound > sc.rounds
        ? `<b>${esc(sc.name)} lasts ${sc.rounds} rounds, so the game is over.</b> Check who won below.`
        : `${esc(sc.name)} lasts ${sc.rounds} rounds. This is round ${currentRound}.`);
      list.push('Check whether anyone has met the scenario\'s winning condition.');
      let html = `<p>Round ${currentRound - 1} is over. The next round starts again at Gear Phase 1.</p>${steps(list)}`;
      if (sc && sc.victory) html += card('How to win', renderRules(sc.victory));
      return { html, options: [{ text: `Start Round ${currentRound}`, next: "Turn_Start" }] };
    }
  },
  "Weapon_Tracker": {
    category: "combat",
    title: "Armory & Weapons",
    render: () => ({
      html: '<p>Add, change or remove weapons, upgrades and perks for this vehicle in the Garage. Track ammo under Loadout &amp; Ammo on the Play tab.</p>',
      options: [{ text: "Edit in Garage", action: "openWeaponBuilder" }, { text: "Back to Gear Phase", next: "Turn_Start" }]
    })
  }
};

// When Pole Position passes, from the scenario's `pole` field.
function poleRule(sc) {
  if (sc && sc.pole === 'gate') return 'In this scenario, Pole Position passes whenever its holder drives a vehicle through a Gate (they choose who gets it).';
  if (sc && sc.pole === 'monster') return 'This scenario has its own Pole Position rules: check the scenario in the Rules tab.';
  return 'At the end of each Gear Phase, Pole Position passes to the next player clockwise.';
}

function wipeoutTarget() {
  return wipeoutRef ? refFromValue(`${wipeoutRef.ti}:${wipeoutRef.vi}`) : null;
}

// ---------- Turn flow actions ----------

function saveGameSetup() {
  maxCans = parseInt(document.getElementById('can-input').value) || 50;
  currentScenario = document.getElementById('scenario-select').value;
  votesEnabled = document.getElementById('votes-toggle').checked;
  refreshTrackerUI();
  saveData();
  loadNode('Deployment');
}

function startNewGame() {
  allVehicles().forEach(({ t, v }) => {
    v.gear = 1;
    v.hazard = 0;
    v.hull = v.maxHull;
    v.onFire = false;
    v.activated = false;
    v.gatesPassed = 0;
    v.scenarioPoints = 0;
    v.items.forEach(it => { const f = findItem(it.id); if (f) it.ammo = itemAmmo(f.data, t); });
  });
  teams.forEach(t => { t.votes = 0; });
  currentPhase = 1;
  currentRound = 1;
  flowHistory = [];
  garageAfterChange();
  loadNode('Turn_Start');
}

function selectActivation(ti, vi) {
  currentTeamIndex = ti;
  currentVehicleIndex = vi;
  garageExpanded = -1;
  updateTeamDropdown();
  updateVehicleDropdown();
  refreshTrackerUI();
  saveData();
  loadNode('Activation_Start');
}

function finishActivation() {
  const v = currentVehicle();
  if (v) v.activated = true;
  refreshTrackerUI();
  saveData();
  loadNode('End_Activation');
}

function flowAdjust(stat, d) {
  updateStat(stat, d);
  loadNode(currentNodeId, true);
}

function flowFireDamage() {
  updateStat('hull', -1);
  loadNode('Activation_Start', true);
}

function flowRollSkid() {
  const v = currentVehicle();
  const n = Math.max(0, Math.min(v.handling, parseInt(document.getElementById('flow-skid-n').value) || 0));
  showSkidResult(rollD6(n), false);
}

function showSkidResult(rolls, pushed) {
  const face = r => r >= 4 ? 'Shift' : ['Hazard', 'Spin', 'Slide'][r - 1];
  const count = f => rolls.filter(r => face(r) === f).length;
  const box = document.getElementById('flow-roll');
  if (!rolls.length) { box.innerHTML = 'No dice rolled: a calm move with no Shifts and no trouble.'; return; }
  box.innerHTML = `${pushed ? 'After Push It: ' : ''}${rolls.map(face).join(', ')}<br><b>${plural(count('Shift'), 'Shift')}</b> · ${plural(count('Hazard'), 'Hazard')} · ${plural(count('Spin'), 'Spin')} · ${plural(count('Slide'), 'Slide')}` +
    (pushed ? '' : `<br><button class="nav-btn btn-small btn-rust" style="margin-top:8px;" onclick='flowPushIt(${JSON.stringify(rolls)})'>Push It: re-roll the non-Shifts (+1 Hazard)</button>`);
}

function flowPushIt(rolls) {
  updateStat('hazard', 1);
  showSkidResult(rolls.map(r => r >= 4 ? r : rollD6(1)[0]), true);
}

function flowSmashDice() {
  const v = currentVehicle();
  const angle = document.getElementById('flow-angle').value;
  const og = angle === 'obstacle' ? 0 : Math.max(0, parseInt(document.getElementById('flow-og').value) || 0);
  let n = angle === 'head' || angle === 'obstacle' ? v.gear + og : angle === 'tbone' ? v.gear : Math.abs(v.gear - og);
  const diff = WEIGHTS.indexOf(v.weight) - WEIGHTS.indexOf(document.getElementById('flow-ow').value);
  const mod = diff >= 2 ? 4 : diff === 1 ? 2 : diff === -1 ? -1 : diff <= -2 ? -2 : 0;
  n = Math.max(0, n + mod);
  document.getElementById('flow-smash-n').innerHTML = `<b>${diceCount(n, 'Smash')}</b>${mod ? ` (incl. ${mod > 0 ? '+' : ''}${mod} for weight)` : ''}`;
  return n;
}

function flowRollSmash() {
  const rolls = rollD6(flowSmashDice());
  const hits = rolls.reduce((a, r) => a + (r === 6 ? 2 : r >= 4 ? 1 : 0), 0);
  lastHits = hits;
  lastSpecialHits = { Blast: 0, Fire: 0 };
  document.getElementById('flow-roll').innerHTML = `Rolled [${rolls.join(', ')}]<br><b>${plural(hits, 'hit')}</b> on the other vehicle (before it Evades).`;
}

let lastSpecialHits = { Blast: 0, Fire: 0 };  // hits from Blast and Fire weapons in the last attack roll

function flowRollAttack() {
  const v = currentVehicle();
  const box = document.getElementById('flow-roll');
  const chosen = [...document.querySelectorAll('[id^="flow-w-"]:checked')].map(el => v.items[parseInt(el.dataset.idx)]);
  const handguns = Math.max(0, parseInt(document.getElementById('flow-hg').value) || 0);
  const attacks = chosen.length + handguns;
  if (!attacks) { box.innerHTML = 'Tick at least one weapon or add a Handgun.'; return; }
  if (attacks > v.crew) { box.innerHTML = `That is ${plural(attacks, 'attack')}, but ${esc(v.name)} has Crew ${v.crew}: it may make at most ${plural(v.crew, 'attack')} this Attack Step.`; return; }

  const cover = document.getElementById('flow-cover').checked;
  const lines = [];
  let total = 0;
  lastSpecialHits = { Blast: 0, Fire: 0 };
  const fire = (w, item, label) => {
    if (item && item.ammo != null) item.ammo--;
    if (!w.attack_dice) { lines.push(`${esc(label)}: no attack dice. ${esc(w.special || 'See the rulebook.')}`); return; }
    const need = cover && !(w.tags || []).includes('Indirect') ? 5 : 4;
    const rolls = rollD6(w.attack_dice);
    const hits = rolls.reduce((a, r) => a + (r === 6 ? 2 : r >= need ? 1 : 0), 0);
    total += hits;
    ['Blast', 'Fire'].forEach(tag => { if ((w.tags || []).includes(tag)) lastSpecialHits[tag] += hits; });
    lines.push(`${esc(label)} [${rolls.join(', ')}] → ${plural(hits, 'hit')}${item && item.ammo != null ? ` (Ammo left ${item.ammo})` : ''}`);
  };
  chosen.forEach(item => { const w = db.weapons.find(x => x.id === item.id); fire(w, item, w.name); });
  const hg = db.weapons.find(x => x.id === 'handgun');
  for (let i = 0; i < handguns; i++) fire(hg, null, 'Handgun');

  lastHits = total;
  refreshTrackerUI();
  saveData();
  box.innerHTML = `${lines.join('<br>')}<br><b>Total: ${plural(total, 'hit')}</b> on the target${cover ? ' (Cover: 5+ to hit)' : ''}.`;
}

function flowRollEvade() {
  const ref = refFromValue(document.getElementById('flow-target').value);
  if (!ref) return;
  const hits = Math.max(0, parseInt(document.getElementById('flow-hits').value) || 0);
  const rolls = rollD6(ref.v.gear);
  const sixes = rolls.filter(r => r === 6).length;
  lastCancelled = Math.min(hits, sixes);
  const dmg = hits - lastCancelled;
  document.getElementById('flow-dmg').value = dmg;
  document.getElementById('flow-roll').innerHTML = `${esc(ref.v.name)} rolled ${diceCount(ref.v.gear, 'Evade')} (its Gear): [${rolls.join(', ')}]<br><b>${plural(lastCancelled, 'hit')} cancelled</b>, ${plural(dmg, 'hit')} get through.`;
}

// Applies damage to the chosen target. Evade cancels plain hits first, so Blast and Fire
// hits are the last to be cancelled.
function flowApplyAttack() {
  const ref = refFromValue(document.getElementById('flow-target').value);
  if (!ref) return;
  const dmg = Math.max(0, parseInt(document.getElementById('flow-dmg').value) || 0);
  const notes = damageVehicle(ref, dmg);
  const blast = Math.min(lastSpecialHits.Blast, dmg);
  if (blast > 0) { ref.v.hazard += blast; notes.push(`Blast: ${ref.v.name} gains ${plural(blast, 'Hazard Token')}.`); }
  if (Math.min(lastSpecialHits.Fire, dmg) > 0 && !ref.v.onFire) { ref.v.onFire = true; notes.push(`Fire: ${ref.v.name} is now On Fire.`); }
  if (lastSpecialHits.Fire && hasPerk(ref.t, 'Fire Walk With Me')) notes.push('Order of the Inferno (Fire Walk With Me) may reduce Fire damage by up to 3 (minimum 1): fix Hull on the Play tab if needed.');
  lastHits = 0;
  lastSpecialHits = { Blast: 0, Fire: 0 };
  garageAfterChange();
  loadNode('Attack_Intro');
  document.getElementById('term-box').innerHTML = notes.map(esc).join('<br>');
  document.getElementById('term-box').style.display = 'block';
}

function flowApplyDamage() {
  const ref = refFromValue(document.getElementById('flow-target').value);
  if (!ref) return;
  const notes = damageVehicle(ref, Math.max(0, parseInt(document.getElementById('flow-dmg').value) || 0));
  garageAfterChange();
  loadNode('Attack_Intro');
  document.getElementById('term-box').innerHTML = notes.map(esc).join('<br>');
  document.getElementById('term-box').style.display = 'block';
}

function damageVehicle(ref, dmg) {
  const before = ref.v.hull;
  ref.v.hull = Math.max(0, ref.v.hull - dmg);
  const notes = [`${ref.v.name} takes ${dmg} damage: Hull ${ref.v.hull}/${ref.v.maxHull}.`];
  if (before > 0 && ref.v.hull === 0) vehicleWrecked(ref.v, ref.t);
  return notes;
}

function flowRollFlip() {
  const w = wipeoutTarget();
  const r = rollD6(1)[0];
  document.getElementById('flow-roll').innerHTML = `Rolled <b>${r}</b> against Gear ${w.v.gear}: ${r < w.v.gear ? '<b style="color:var(--danger);">it Flips!</b> Tap "It Flipped".' : '<b>no Flip.</b> Tap "No Flip".'}`;
}

function initApp() {
  loadData();
  if (!teams.length) teams = [newTeam('Team 1', 'none')];
  fillScenarioSelect(document.getElementById('settings-scenario-select'));
  updateTeamDropdown();
  updateVehicleDropdown();
  refreshTrackerUI();
  loadNode(firstRun ? "How_To_Play" : "Turn_Start");
  let tab = 'play';
  try { tab = localStorage.getItem('gaslandsTacticalFlowTab') || 'play'; } catch (e) {}
  switchTab(document.getElementById('tab-' + tab) ? tab : 'play');
  let details = '';
  let strip = '1';
  try {
    details = localStorage.getItem('gaslandsTacticalFlowDetails') || '';
    strip = localStorage.getItem('gaslandsTacticalFlowStrip') ?? '1';
  } catch (e) {}
  teamStripOpen = strip === '1';
  togglePlayDetails(details === '1');
}

let playDetailsOpen = false;  // Play tab: team pickers and full tracker shown
let teamStripOpen = true;      // Play tab: team status bar lists every vehicle

// Shows or hides the team pickers and full tracker so the turn guide sits at the top of Play.
function togglePlayDetails(open) {
  playDetailsOpen = open === undefined ? !playDetailsOpen : open;
  document.getElementById('play-details').style.display = playDetailsOpen ? 'flex' : 'none';
  try { localStorage.setItem('gaslandsTacticalFlowDetails', playDetailsOpen ? '1' : ''); } catch (e) {}
  renderTeamStrip();
  window.scrollTo(0, 0);
}

// Minimizes the team status bar to a single line, or lists every vehicle again.
function toggleTeamStrip() {
  teamStripOpen = !teamStripOpen;
  try { localStorage.setItem('gaslandsTacticalFlowStrip', teamStripOpen ? '1' : '0'); } catch (e) {}
  renderTeamStrip();
}

function selectStripVehicle(i) {
  currentVehicleIndex = i;
  updateVehicleDropdown();
  refreshTrackerUI();
  saveData();
  if (currentNodeId) loadNode(currentNodeId, true);
}

function renderTeamStrip() {
  const strip = document.getElementById('team-strip');
  const team = currentTeam(), v = currentVehicle();
  if (!strip || !team) return;
  const n = team.roster.length;
  const brief = v ? ` · ${esc(v.name)}: Gear ${v.gear}, Hazards ${v.hazard}, Hull ${v.hull}` : '';
  let html = `<div class="ts-head">
      <button class="ts-title" onclick="toggleTeamStrip()" aria-expanded="${teamStripOpen}" aria-controls="ts-rows">
        <span class="ts-name">${esc(team.teamName)}<small>${plural(n, 'vehicle')} · ${calculateTotalCansSpent()}/${maxCans} Cans${teamStripOpen ? '' : brief}</small></span>
        <span class="vs-chev">${teamStripOpen ? '▴' : '▾'}</span>
      </button>
      <button class="ts-btn" onclick="togglePlayDetails()" aria-expanded="${playDetailsOpen}" aria-controls="play-details">Tracker ${playDetailsOpen ? '▴' : '▾'}</button>
    </div>`;
  if (teamStripOpen && n) {
    html += `<div class="ts-rows" id="ts-rows">${team.roster.map((x, i) => {
      const danger = x.hazard >= wipeoutAt(team);
      const done = x.activated ? ' ✓' : '';
      return `<button class="ts-row${i === currentVehicleIndex ? ' active' : ''}${x.hull <= 0 ? ' wrecked' : ''}" onclick="selectStripVehicle(${i})" aria-pressed="${i === currentVehicleIndex}">
          <span class="vs-name">${esc(x.name)}${x.onFire ? ' 🔥' : ''}${done}<br><small>${esc(x.type)}${x.hull <= 0 ? ' · WRECKED' : ''}</small></span>
          <span class="ts-cell"><small>Gear</small>${x.gear}/${x.maxGear}</span>
          <span class="ts-cell" style="color:${danger ? 'var(--danger)' : 'var(--yellow)'};"><small>Hazards</small>${x.hazard}</span>
          <span class="ts-cell" style="color:var(--green);"><small>Hull</small>${x.hull}/${x.maxHull}</span>
        </button>`;
    }).join('')}</div>`;
  }
  strip.innerHTML = html;
}

// Bottom tab bar. The team status bar under the header only shows on Play.
function switchTab(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.id === 'tab-' + id));
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.id === 'tabbtn-' + id));
  document.getElementById('team-strip').style.display = id === 'play' ? '' : 'none';
  try { localStorage.setItem('gaslandsTacticalFlowTab', id); } catch (e) {}
}

function switchTeam(index) {
  currentTeamIndex = parseInt(index);
  currentVehicleIndex = 0;
  garageExpanded = -1;
  updateTeamDropdown();
  updateVehicleDropdown();
  refreshTrackerUI();
  saveData();
}

function switchVehicle(index) {
  currentVehicleIndex = parseInt(index);
  refreshTrackerUI();
  saveData();
}

function updateTeamDropdown() {
  const select = document.getElementById('team-select');
  select.innerHTML = '';
  teams.forEach((t, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.innerText = (t.teamName || "Team") + ` (${sponsorLabel(t)})`;
    if (i === currentTeamIndex) opt.selected = true;
    select.appendChild(opt);
  });
}

function updateVehicleDropdown() {
  const select = document.getElementById('vehicle-select');
  select.innerHTML = '';
  const team = currentTeam();
  if (!team || !team.roster) return;

  team.roster.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.innerText = (v.name || "Vehicle") + ` [${v.type}] (Hull: ${v.hull}/${v.maxHull})` + (v.hull <= 0 ? ' WRECKED' : '');
    if (i === currentVehicleIndex) opt.selected = true;
    select.appendChild(opt);
  });
}

// ---------- Vehicles ----------

// Sponsor and type restrictions for adding a vehicle type to a team. Returns a list of problems.
function vehicleProblems(team, t, ignoreIndex) {
  const p = [];
  const others = team.roster.filter((v, i) => i !== ignoreIndex);
  if (t.restricted) {
    if (!hasPerk(team, 'Military Hardware')) p.push(`${t.name} is Restricted: only Rutherford (Military Hardware) may buy it.`);
    else if (others.some(v => v.typeId === t.id)) p.push(`Rutherford may only buy a single ${t.name}.`);
  }
  if (hasPerk(team, 'Might Is Right') && t.weight === 'Lightweight') p.push('Rutherford (Might Is Right): no Lightweight vehicles.');
  if (hasPerk(team, 'Elegance') && t.handling <= 2) p.push('Miyazaki (Elegance): no vehicle types with base Handling 2 or lower.');
  if (hasPerk(team, 'Kiss My Asphalt') && t.id === 'gyrocopter') p.push('Idris (Kiss My Asphalt): no Gyrocopters.');
  return p;
}

function rosterProblems(team) {
  const p = [];
  team.roster.forEach((v, i) => {
    const t = vehicleType(v.typeId);
    if (t) vehicleProblems(team, t, i).forEach(x => p.push(`${v.name}: ${x}`));
    v.items.forEach(i2 => {
      const it = findItem(i2.id);
      if (it && it.data.mishkin_only && team.sponsor !== 'mishkin') p.push(`${v.name}: ${it.data.name} needs Mishkin (Thumpermonkey).`);
      if (it && it.data.sponsor_only && it.data.sponsor_only !== team.sponsor) p.push(`${v.name}: ${it.data.name} is a sponsor-only upgrade.`);
    });
  });
  return p;
}

function updateStat(type, amount) {
  const team = currentTeam();
  const v = currentVehicle();
  if (!v) return;

  if (type === 'gear') {
    v.gear = Math.max(1, Math.min(v.maxGear, v.gear + amount));
  } else if (type === 'hazard') {
    v.hazard = Math.max(0, v.hazard + amount);
    if (amount > 0 && v.hazard === wipeoutAt(team)) {
      if (confirm(`${v.hazard} Hazard Tokens: this vehicle will Wipe Out in the Wipeout Step. Go to the Wipeout Step now?`)) {
        loadNode("Wipeout_Phase_Check");
      }
    }
  } else if (type === 'hull') {
    const before = v.hull;
    v.hull = Math.max(0, Math.min(v.maxHull, v.hull + amount));
    if (before > 0 && v.hull === 0) vehicleWrecked(v);
  } else if (type === 'votes') {
    team.votes = Math.max(0, (team.votes || 0) + amount);
  }
  updateVehicleDropdown();
  refreshTrackerUI();
  saveData();
}

function vehicleWrecked(v, t) {
  t = t || currentTeam();
  if (votesEnabled) t.votes = (t.votes || 0) + 1;
  const dice = db.core_rules.explosion_dice[v.weight] || '';
  const ammo = v.items.reduce((a, i) => a + (i.ammo || 0), 0);
  alert(`${v.name} is WRECKED!\n\n` +
    `1. Skid to a halt: move it straight forward along a Short Straight (a crash at the end is a Collision).\n` +
    `2. It drops to Gear 1 and loses all Hazard Tokens.\n` +
    `3. Explosion check: roll a D6 and add its ${ammo} Ammo token${ammo === 1 ? '' : 's'}. On 6 or more it explodes: a ${dice} attack with Blast against every vehicle within Medium range (they may Evade), then remove it.\n` +
    `4. Otherwise turn it upside down: it stays as a wreck. If it was Wrecked in a Collision, remove it instead.` +
    (votesEnabled ? `\n\n${t.teamName} gains 1 Audience Vote.` : ''));
  v.gear = 1;
  v.hazard = 0;
}

function toggleOnFire() {
  const v = currentVehicle();
  if (!v) return;
  v.onFire = !v.onFire;
  refreshTrackerUI();
  saveData();
}

function updateScenarioProgress(amount) {
  const v = currentVehicle();
  if (!v) return;

  if (currentScenario === 'death_race') {
    v.gatesPassed = Math.max(0, (v.gatesPassed || 0) + amount);
  } else {
    v.scenarioPoints = Math.max(0, (v.scenarioPoints || 0) + amount);
  }
  refreshTrackerUI();
  saveData();
}

function calculateTotalCansSpent() {
  return currentTeam().roster.reduce((acc, v) => acc + (v.cost || 0), 0);
}

function refreshTrackerUI() {
  const team = currentTeam();
  const v = currentVehicle();
  document.getElementById('round-phase-chip').innerText = `R${currentRound} · G${currentPhase}`;
  renderTeamStrip();
  renderGarage();
  document.getElementById('play-empty').style.display = v ? 'none' : 'block';
  document.getElementById('tracker-bar').style.display = v ? '' : 'none';
  document.getElementById('play-loadout').style.display = v ? '' : 'none';
  // Keep the turn flow in step when a roster becomes empty or gets its first vehicle.
  if (!v) { if (!noVehiclePrompt) loadNode('Turn_Start'); return; }
  if (noVehiclePrompt) loadNode('Turn_Start');

  document.getElementById('gear-display').innerText = `${v.gear}/${v.maxGear}`;
  const hz = document.getElementById('hazard-display');
  hz.innerText = v.hazard;
  hz.style.textDecoration = v.hazard >= wipeoutAt(team) ? 'underline' : 'none';
  document.getElementById('hull-display').innerText = `${v.hull}/${v.maxHull}`;
  document.getElementById('handling-display').innerText = v.handling;
  document.getElementById('crew-display').innerText = v.crew;
  document.getElementById('slots-display').innerText = `${usedSlots(v, team)}/${v.slots}`;
  document.getElementById('vehicle-info-display').innerHTML =
    `${esc(v.type)} · ${esc(v.weight)} · ${v.cost} Cans` + (v.special ? `<br>Special: ${esc(v.special)}` : '') +
    (v.hull <= 0 ? `<br><span style="color:#ff4444; font-weight:bold;">WRECKED</span>` : '');
  const fire = document.getElementById('fire-display');
  if (fire) { fire.innerText = v.onFire ? 'ON FIRE' : 'No'; fire.style.color = v.onFire ? '#ff8800' : '#aaa'; }

  const votesStatElement = document.getElementById('votes-tracker-container');
  if (votesStatElement) {
    votesStatElement.style.display = votesEnabled ? 'flex' : 'none';
    document.getElementById('votes-display').innerText = team.votes || 0;
  }

  const dashWeapons = document.getElementById('dashboard-weapons-list');
  if (dashWeapons) {
    if (!v.items.length) {
      dashWeapons.innerHTML = "None equipped.";
    } else {
      dashWeapons.innerHTML = v.items.map((i, idx) => {
        const it = findItem(i.id);
        if (!it) return '';
        const ammo = i.ammo == null ? '' : ` · Ammo <b>${i.ammo}</b> <button class="stat-btn" style="width:20px; height:20px; font-size:11px;" onclick="adjustAmmo(${idx}, -1)">-</button><button class="stat-btn" style="width:20px; height:20px; font-size:11px; margin-left:2px;" onclick="adjustAmmo(${idx}, 1)">+</button>`;
        const facing = i.facing ? ` (${esc(i.facing)})` : '';
        const stats = it.kind === 'weapon' ? ` ${it.data.attack_dice}D6 ${esc(it.data.range)}` : '';
        return `<div style="margin-bottom:3px;">• ${esc(it.data.name)}${facing}${stats}${ammo}</div>`;
      }).join('');
    }
  }

  const dashPerks = document.getElementById('dashboard-perks-list');
  if (dashPerks) {
    const perks = (v.perks || []).map(findPerk).filter(Boolean);
    dashPerks.innerHTML = perks.length
      ? perks.map(p => `<div style="margin-bottom:3px;" title="${esc(p.description)}">• ${esc(p.name)} <span style="color:#aaa;">(${esc(p.perk_class)}, ${p.cost} Cans)</span></div>`).join('')
      : "None bought.";
  }

  const goalLabel = document.getElementById('scenario-goal-label');
  const progressDisplay = document.getElementById('scenario-progress-display');
  if (goalLabel && progressDisplay) {
    const sc = db.scenarios.find(x => x.id === currentScenario);
    if (currentScenario === 'death_race') {
      goalLabel.innerText = "Gates Passed:";
      progressDisplay.innerText = v.gatesPassed || 0;
    } else if (sc && sc.score) {
      goalLabel.innerText = `${sc.name}: ${sc.score.label}` + (sc.score.target ? ` (goal ${sc.score.target})` : '') + ':';
      progressDisplay.innerText = v.scenarioPoints || 0;
    } else {
      goalLabel.innerText = (sc ? sc.name + ': ' : '') + "Objective Points:";
      progressDisplay.innerText = v.scenarioPoints || 0;
    }
  }
}

function adjustAmmo(idx, d) {
  const v = currentVehicle();
  const i = v && v.items[idx];
  if (!i || i.ammo == null) return;
  i.ammo = Math.max(0, i.ammo + d);
  refreshTrackerUI();
  saveData();
}

// ---------- Gear phases ----------

function nextGearPhase() {
  // Order of the Inferno: Cult of Flame at the end of each Gear Phase.
  teams.forEach(t => {
    if (!hasPerk(t, 'Cult of Flame')) return;
    const mine = t.roster.filter(v => v.onFire && v.hull > 0).length;
    const enemies = teams.filter(o => o !== t).reduce((acc, o) => acc + o.roster.filter(v => v.onFire && v.hull > 0).length, 0);
    if (votesEnabled && enemies > mine && mine > 0) { t.votes = (t.votes || 0) + mine; alert(`${t.teamName}: Cult of Flame +${mine} Audience Vote(s).`); }
  });
  allVehicles().forEach(({ v }) => { v.activated = false; });
  if (currentPhase < 6) {
    currentPhase++;
    refreshTrackerUI();
    saveData();
    loadNode('Turn_Start');
    return;
  }
  currentPhase = 1;
  currentRound++;
  refreshTrackerUI();
  saveData();
  loadNode('Round_End');
}

function applyWipeoutPass() {
  const w = wipeoutTarget();
  if (w) { w.v.gear = 1; w.v.hazard = 0; }
  wipeoutRef = null;
  garageAfterChange();
  loadNode('Wipeout_Phase_Check');
}

function applyWipeoutFlip() {
  const w = wipeoutTarget();
  if (w) {
    const before = w.v.hull;
    w.v.hull = Math.max(0, w.v.hull - 2);
    w.v.gear = 1;
    w.v.hazard = 0;
    if (before > 0 && w.v.hull === 0) vehicleWrecked(w.v, w.t);
  }
  wipeoutRef = null;
  garageAfterChange();
  loadNode('Wipeout_Phase_Check');
}

// ---------- Reference indexes ----------

function handleIndexSelect(val) {
  if (!val) return;
  const map = {
    combat: () => filterRules('combat'),
    movement: () => filterRules('movement'),
    wipeout: () => filterRules('wipeout'),
    driving: showDrivingDirectory,
    campaign: showCampaignDirectory,
    equipment: showEquipmentDirectory,
    cover: showCoverDirectory,
    hazard: showHazardDirectory,
    collision: showCollisionDirectory,
    votes: showVotesDirectory,
    universal: showUniversalRulesDirectory,
    scenario: showScenarioDirectory,
    sponsor: showSponsorDirectory,
    weapon: showWeaponDirectory,
    chassis: showChassisDirectory,
    glossary: showGlossary,
    howto: () => { switchTab('play'); loadNode('How_To_Play'); }
  };
  if (map[val]) map[val]();
}

// Shows a turn-flow step. `inPlace` re-renders without adding to the Back history or scrolling.
function loadNode(nodeID, inPlace) {
  const node = rulesData[nodeID];
  if (!node) return;

  const team = currentTeam();
  const v = currentVehicle();
  noVehiclePrompt = !v && !node.noVehicle;
  document.getElementById('term-box').style.display = 'none';
  if (noVehiclePrompt) {
    document.getElementById('prompt-text').innerHTML = `<b class="flow-title">NO VEHICLES</b>${esc(team.teamName)} has no vehicles yet. Add some in the Garage.`;
    document.getElementById('button-container').innerHTML = `<button class="nav-btn" onclick="switchTab('garage')">Go to Garage</button>`;
    return;
  }
  if (!inPlace && currentNodeId && currentNodeId !== nodeID) {
    flowHistory.push(currentNodeId);
    if (flowHistory.length > 40) flowHistory.shift();
  }
  currentNodeId = nodeID;

  const view = node.render(team, v);
  const prompt = document.getElementById('prompt-text');
  prompt.innerHTML = `<b class="flow-title">${esc(node.title.toUpperCase())}</b>${view.html}`;
  linkTerms(prompt);

  const btnContainer = document.getElementById('button-container');
  btnContainer.innerHTML = '';
  view.options.forEach(option => {
    const btn = document.createElement('button');
    btn.className = 'nav-btn' + (option.style ? ' ' + option.style : '');
    btn.innerText = option.text;
    btn.onclick = () => {
      if (option.fn) option.fn();
      else if (option.action) window[option.action]();
      else loadNode(option.next);
    };
    btnContainer.appendChild(btn);
  });
  if (flowHistory.length) {
    const back = document.createElement('button');
    back.className = 'nav-btn btn-grey btn-small';
    back.style.marginTop = '4px';
    back.innerText = '‹ Back';
    back.onclick = () => loadNode(flowHistory.pop(), true);
    btnContainer.appendChild(back);
  }
  if (view.after) view.after();
  if (!inPlace) {
    const box = document.getElementById('prompt-box');
    if (box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: 'start' });
  }
}

// Lists the turn-flow steps in a category; each opens that step on the Play tab.
function filterRules(categoryKey) {
  showReference(`<b>TURN STEPS: ${categoryKey.toUpperCase()}</b><br><span class="muted small">Opens the step on the Play tab.</span>`);
  const btnContainer = document.getElementById('rules-buttons');
  let matchCount = 0;

  for (const key in rulesData) {
    const node = rulesData[key];
    if (node.category === categoryKey) {
      matchCount++;
      const title = node.title;

      const btn = document.createElement('button');
      btn.className = 'nav-btn';
      btn.innerText = title;
      btn.onclick = () => { switchTab('play'); loadNode(key); };
      btnContainer.appendChild(btn);
    }
  }

  if (matchCount === 0) {
    btnContainer.innerHTML = "No rules found in this category.";
  }
}

// Shows reference HTML on the Rules tab in place of the index.
function showReference(html) {
  document.getElementById('rules-content').innerHTML = html;
  document.getElementById('rules-buttons').innerHTML = '';
  document.getElementById('rules-index').style.display = 'none';
  document.getElementById('rules-view').style.display = 'block';
  switchTab('rules');
  window.scrollTo(0, 0);
}

function closeReference() {
  document.getElementById('rules-view').style.display = 'none';
  document.getElementById('rules-index').style.display = 'block';
  window.scrollTo(0, 0);
}

function card(title, body) {
  return `<div class="ref-card"><span class="ref-card-title">${title}</span>${body ? '<br>' + body : ''}</div>`;
}

function prettyKey(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Renders nested rule data (objects, arrays, strings) as readable HTML.
function renderRules(obj) {
  if (obj == null) return '';
  if (Array.isArray(obj)) return obj.map(x => typeof x === 'object' ? `<div style='margin:4px 0 4px 8px;'>${renderRules(x)}</div>` : `• ${esc(x)}`).join('<br>');
  if (typeof obj === 'object') return Object.entries(obj).map(([k, val]) =>
    typeof val === 'object' && val !== null
      ? `<div style='margin-top:6px;'><span style='color:#ffcc00;'>${esc(prettyKey(k))}</span><div style='margin-left:8px;'>${renderRules(val)}</div></div>`
      : `<div><span style='color:#ffcc00;'>${esc(prettyKey(k))}:</span> ${esc(val)}</div>`
  ).join('');
  return esc(obj);
}

function showChassisDirectory() {
  let html = "<b>VEHICLE INDEX</b><br><br>";
  db.vehicles.forEach(t => {
    html += card(`${esc(t.name)}`, `${t.weight}${t.advanced ? ' · Advanced' : ''}${t.restricted ? ' · Restricted' : ''}<br><span style='color:#00cc66;'>Hull ${t.hull} | Handling ${t.handling} | Max Gear ${t.max_gear} | Crew ${t.crew} | Slots ${t.slots} | ${t.cost} Cans</span>` + (t.special ? `<br><span style='color:#aaa; font-size:12px;'>${esc(t.special)}</span>` : ''));
  });
  showReference(html);
}

function showWeaponDirectory() {
  let html = "<b>ARMORY INDEX</b><br><br>";
  [['vehicle', 'Vehicle Weapons'], ['crew', 'Crew Weapons'], ['dropped', 'Dropped Weapons']].forEach(([cat, label]) => {
    html += `<div style='color:#ff8800; font-weight:bold; margin:8px 0 4px;'>${label}</div>`;
    db.weapons.filter(w => w.category === cat).forEach(w => {
      html += card(`${esc(w.name)}${w.mishkin_only ? ' (Mishkin only)' : ''}`, `<span style='color:#00cc66;'>${w.attack_dice}D6 | ${esc(w.range)} | Slots ${w.build_slots} | ${w.cost} Cans</span>` + (w.special ? `<br><span style='color:#aaa; font-size:12px;'>${esc(w.special)}</span>` : ''));
    });
  });
  showReference(html);
}

function showEquipmentDirectory() {
  let html = "<b>UPGRADES INDEX</b><br><br>";
  db.upgrades.forEach(u => {
    const who = u.mishkin_only ? ' (Mishkin only)' : u.sponsor_only ? ` (${esc((db.sponsors.find(s => s.id === u.sponsor_only) || {}).name || u.sponsor_only)} only)` : '';
    html += card(`${esc(u.name)}${who}`, `<span style='color:#00cc66;'>Slots ${u.build_slots} | ${u.cost} Cans${u.once_only ? ' | Once per vehicle' : ''}</span><br><span style='color:#aaa; font-size:12px;'>${esc(u.description)}</span>`);
  });
  showReference(html);
}

function showScenarioDirectory() {
  let html = "<b>SCENARIO INDEX</b><br><br>Tap a scenario for its full rules.";
  showReference(html);
  const btnContainer = document.getElementById('rules-buttons');
  btnContainer.style.marginTop = '10px';
  db.scenarios.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'nav-btn btn-grey';
    btn.innerText = `${s.name} (${s.category}, p.${s.page})`;
    btn.onclick = () => showScenarioDetail(s.id);
    btnContainer.appendChild(btn);
  });
}

function showScenarioDetail(id) {
  const s = db.scenarios.find(x => x.id === id);
  if (!s) return;
  const sections = [['Teams', s.teams], ['Setup', s.setup], ['Deployment', s.deployment], ['Special Rules', s.special_rules], ['Game End', s.game_end], ['Victory', s.victory], ['Spoils', s.spoils]];
  let html = `<b>${esc(s.name.toUpperCase())}</b><br><span style='color:#aaa;'>${esc(s.category)} · p.${s.page}${s.rounds ? ` · ${s.rounds} rounds` : ''}</span><br><br>`;
  sections.forEach(([label, val]) => { if (val && (!Array.isArray(val) || val.length)) html += card(label, renderRules(val)); });
  showReference(html);
  const btn = document.createElement('button');
  btn.className = 'nav-btn';
  btn.innerText = currentScenario === s.id ? '✓ Current Scenario' : 'Play This Scenario';
  btn.disabled = currentScenario === s.id;
  btn.onclick = () => { currentScenario = s.id; refreshTrackerUI(); saveData(); showScenarioDetail(s.id); };
  document.getElementById('rules-buttons').appendChild(btn);
  const back = document.createElement('button');
  back.className = 'nav-btn btn-grey';
  back.innerText = '‹ All Scenarios';
  back.onclick = showScenarioDirectory;
  document.getElementById('rules-buttons').appendChild(back);
}

function showSponsorDirectory() {
  let html = "<b>SPONSOR INDEX</b><br><br>";
  db.sponsors.forEach(s => {
    html += card(`${esc(s.name)} (p.${s.page})`, `<span style='color:#00cc66;'>Perk classes: ${s.perk_classes.join(', ')}</span>` + (s.wipeout_at && s.wipeout_at !== 6 ? `<br>Wipes out at ${s.wipeout_at} Hazards` : '') + '<br>' + s.perks.map(p => `<b>${esc(p.name)}:</b> <span style='color:#ccc;'>${esc(p.text)}</span>`).join('<br>'));
  });
  showReference(html);
}

function showUniversalRulesDirectory() {
  const c = db.core_rules;
  showReference("<b>UNIVERSAL RULES</b><br><br>" +
    card('The Round', esc(c.round)) +
    card('Activation', esc(c.activation)) +
    card('Wrecked', esc(c.wrecked)) +
    card('Explosions', Object.entries(c.explosion_dice).map(([k, d]) => `${k}: ${d}`).join('<br>')) +
    card('More Rules', renderRules(db.rules_extra)));
}

function showVotesDirectory() {
  const v = db.core_rules.audience_votes;
  showReference("<b>AUDIENCE VOTES</b><br><br>" +
    card('Gain Votes', Object.entries(v.gain).map(([k, n]) => `${esc(k)}: +${n}`).join('<br>')) +
    card('Spend Votes', Object.entries(v.spend).map(([k, n]) => `${esc(k)}: ${n} vote${n === 1 ? '' : 's'}`).join('<br>')));
}

function showCollisionDirectory() {
  const c = db.core_rules.collision;
  showReference("<b>COLLISIONS</b><br><br>" +
    card('Smash Dice', esc(c.orientation)) +
    card('Weight Difference', Object.entries(c.weight_difference).map(([k, d]) => `${esc(k)}: ${esc(d)}`).join('<br>')) +
    card('Hazards', esc(c.hazards)) +
    card('Obstacles', esc(c.obstacles)));
}

function showHazardDirectory() {
  const c = db.core_rules;
  showReference("<b>HAZARDS & SKID DICE</b><br><br>" +
    card('Skid Dice (D6)', Object.entries(c.skid_dice_d6).map(([k, d]) => `${esc(k)}: ${esc(d)}`).join('<br>')) +
    card('Push It', esc(c.push_it)) +
    card('Wipeout', esc(c.wipeout)));
}

function showCoverDirectory() {
  showReference("<b>COVER, ATTACKS & TERRAIN</b><br><br>" +
    card('Attacks & Cover', esc(db.core_rules.attack)) +
    card('Terrain', renderRules(db.terrain)));
}

function showCampaignDirectory() {
  showReference("<b>CAMPAIGN RULES</b><br><br>" + renderRules(db.campaign));
}

function showDrivingDirectory() {
  let rows = db.templates.map(t => `<tr><td>${esc(t.name)}</td><td>${t.trivial.join(', ') || '-'}</td><td>${t.hazardous.join(', ') || '-'}</td></tr>`).join('');
  showReference("<b>DRIVING & TEMPLATES</b><br><br>" +
    card('Templates by Gear', `<table style='width:100%; font-size:12px; border-collapse:collapse;'><tr style='color:#ffcc00;'><td>Template</td><td>Trivial</td><td>Hazardous</td></tr>${rows}</table>`) +
    card('Push It', esc(db.core_rules.push_it)) +
    card('Ramps', esc(db.rules_extra.ramps)) +
    card('Airborne', esc(db.rules_extra.airborne)));
}

// ---------- Settings ----------

function openSettings() {
  document.getElementById('settings-can-input').value = maxCans;
  document.getElementById('settings-scenario-select').value = currentScenario;
  document.getElementById('settings-votes-toggle').checked = votesEnabled;
  document.getElementById('settings-modal').style.display = 'flex';
}

function closeSettings() {
  document.getElementById('settings-modal').style.display = 'none';
}

function updateSettingsCanCap(val) {
  const parsed = parseInt(val);
  if (!isNaN(parsed)) {
    maxCans = parsed;
    refreshTrackerUI();
    saveData();
  }
}

function updateSettingsScenario(val) {
  currentScenario = val;
  refreshTrackerUI();
  saveData();
}

function toggleSettingsVotes(isChecked) {
  votesEnabled = isChecked;
  refreshTrackerUI();
  saveData();
}

function presetVehicle(team, typeId, name, itemIds) {
  const v = makeVehicle(typeId, name);
  itemIds.forEach(id => { const it = findItem(id); v.items.push({ id, facing: it.data.attack_dice !== undefined && it.data.category === 'vehicle' ? 'Front' : '', ammo: itemAmmo(it.data, team) }); });
  recalcVehicle(v, team);
  return v;
}

function loadPresetRoster(sponsorType) {
  if (sponsorType === 'rutherford') {
    const team = { teamName: "Rutherford Heavy Metal", sponsor: "rutherford", votes: 0, roster: [] };
    team.roster.push(presetVehicle(team, 'tank', 'Rutherford Tank', ['heavy_machine_gun']));
    teams = [team];
  } else if (sponsorType === 'mishkin') {
    const team = { teamName: "Mishkin Science Division", sponsor: "mishkin", votes: 0, roster: [] };
    team.roster.push(presetVehicle(team, 'car', 'Mishkin Interceptor', ['arc_lightning']));
    team.roster.push(presetVehicle(team, 'performance_car', 'Mishkin Prototype', ['minigun']));
    teams = [team];
  }
  currentTeamIndex = 0;
  currentVehicleIndex = 0;
  maxCans = 50;
  updateTeamDropdown();
  updateVehicleDropdown();
  refreshTrackerUI();
  saveData();
  alert(`Loaded preset roster: ${teams[0].teamName}!`);
  closeSettings();
}

function openCampaignLedger() {
  closeSettings();
  document.getElementById('campaign-modal').style.display = 'flex';
}

function closeCampaignLedger() {
  document.getElementById('campaign-modal').style.display = 'none';
}

function applyCampaignSalvage() {
  const earned = parseInt(document.getElementById('campaign-earned-cans').value) || 0;
  const repairs = parseInt(document.getElementById('campaign-repair-pts').value) || 0;
  const net = earned - repairs;
  maxCans += net;
  refreshTrackerUI();
  saveData();
  alert(`Campaign Salvage Applied!\nEarned: +${earned} Cans\nRepairs: -${repairs} Cans\nNet Added to Vault: ${net} Cans`);
  closeCampaignLedger();
}

function resetGameState() {
  if (confirm("Are you sure you want to wipe all local save data and reset teams?")) {
    localStorage.removeItem('gaslandsTacticalFlowSave');
    location.reload();
  }
}

function exportRosters() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(teams, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", "gaslands_tactical_flow_export.json");
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function importRosters(event) {
  const fileReader = new FileReader();
  if (event.target.files[0]) {
    fileReader.readAsText(event.target.files[0], "UTF-8");
    fileReader.onload = (e) => {
      try {
        const importedTeams = JSON.parse(e.target.result);
        if (Array.isArray(importedTeams)) {
          teams = importedTeams.map(normalizeTeam);
          currentTeamIndex = 0;
          currentVehicleIndex = 0;
          updateTeamDropdown();
          updateVehicleDropdown();
          refreshTrackerUI();
          saveData();
          alert("Rosters successfully imported!");
          closeSettings();
        } else {
          alert("Invalid JSON format.");
        }
      } catch (err) {
        alert("Error parsing JSON file.");
      }
    };
  }
}

// ---------- Dice ----------

function openDiceRollerModal() {
  switchTab('dice');
}

function rollAttackDice() {
  const count = parseInt(document.getElementById('attack-dice-count').value) || 1;
  const cover = document.getElementById('attack-cover-toggle').checked;
  const need = cover ? 5 : 4;
  let hits = 0;
  let crits = 0;
  let rolls = [];
  for (let i = 0; i < count; i++) {
    let roll = Math.floor(Math.random() * 6) + 1;
    rolls.push(roll);
    if (roll === 6) { crits++; hits += 2; }
    else if (roll >= need) { hits += 1; }
  }
  lastAttackRolls = rolls;
  document.getElementById('dice-results-box').innerHTML = `Attack Rolls (hit on ${need}+): [${rolls.join(', ')}]<br><span style="color:#ffcc00; font-weight:bold;">Total Hits: ${hits}</span> (${crits} Crits)`;
}

function rollEvadeDice() {
  const v = currentVehicle();
  const count = v ? v.gear : 1;
  let rolls = [];
  for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * 6) + 1);
  const saved = rolls.filter(r => r === 6).length;
  document.getElementById('dice-results-box').innerHTML = `Evade Rolls (Gear ${count}): [${rolls.join(', ')}]<br><span style="color:#ffcc00; font-weight:bold;">Hits Cancelled: ${saved}</span>`;
}

function rollSkidDice() {
  const count = parseInt(document.getElementById('skid-dice-count').value) || 1;
  const faces = ["Hazard (1)", "Spin (2)", "Slide (3)", "Shift (4)", "Shift (5)", "Shift (6)"];
  let results = [];
  for (let i = 0; i < count; i++) {
    let roll = Math.floor(Math.random() * 6);
    results.push(faces[roll]);
  }
  document.getElementById('dice-results-box').innerHTML = `Skid Rolls:<br><span style="color:#ffcc00;">${results.join('<br>')}</span>`;
}

// ---------- Garage ----------

let garageExpanded = -1;      // index of the open vehicle card, -1 for none
let garageLastItem = 'machine_gun';
let garageNewType = 'car';

// The Play tab's "Open Armory" goes to this vehicle's card in the Garage.
function openWeaponBuilder() {
  garageExpanded = currentVehicleIndex;
  switchTab('garage');
  renderGarage();
  const el = document.getElementById('veh-card-' + currentVehicleIndex);
  if (el) el.scrollIntoView({ block: 'start' });
}

function garageAfterChange() {
  updateTeamDropdown();
  updateVehicleDropdown();
  refreshTrackerUI();
  saveData();
}

function renderGarage() {
  const root = document.getElementById('garage-root');
  const team = currentTeam();
  if (!root || !team) return;
  const s = sponsorOf(team);
  const spent = calculateTotalCansSpent();
  const over = spent > maxCans;
  const pct = maxCans > 0 ? Math.min(100, spent / maxCans * 100) : 100;

  let html = `<div class="card">
    <h2 class="card-title">Teams</h2>
    <div class="team-chips">
      ${teams.map((t, i) => `<button class="chip-btn${i === currentTeamIndex ? ' active' : ''}" onclick="switchTeam(${i})">${esc(t.teamName)}</button>`).join('')}
      <button class="chip-btn chip-add" onclick="garageAddTeam()">+ New Team</button>
    </div>
    <div class="modal-stack" style="margin-top:12px;">
      <div>
        <label class="field-label" for="g-team-name">Team name</label>
        <input type="text" id="g-team-name" value="${esc(team.teamName)}" onchange="garageRenameTeam(this.value)">
      </div>
      <div>
        <label class="field-label" for="g-team-sponsor">Sponsor</label>
        <select id="g-team-sponsor" onchange="garageSetSponsor(this.value)" style="color:var(--yellow);">${sponsorOptions(team.sponsor)}</select>
        <div class="small muted" style="margin-top:4px;">${s
          ? `Perk classes: ${s.perk_classes.join(', ')}<br>Sponsor perks: ${s.perks.map(p => esc(p.name)).join(', ')}${s.wipeout_at && s.wipeout_at !== 6 ? ` · Wipes out at ${s.wipeout_at} Hazards` : ''}`
          : 'Independent teams have no sponsor perks and cannot buy perks.'}</div>
      </div>
      <div class="setting-row">
        <label for="g-can-cap">Can cap (this match)</label>
        <input type="number" id="g-can-cap" value="${maxCans}" min="0" style="width:90px; text-align:center;" onchange="garageSetCanCap(this.value)">
      </div>
      <div>
        <div class="row small" style="justify-content:space-between;"><span>Cans spent</span><b style="color:${over ? 'var(--danger)' : 'var(--yellow)'};">${spent} / ${maxCans}${over ? ' · over cap' : ''}</b></div>
        <div class="cans-bar"><div style="width:${pct}%; background:${over ? 'var(--danger)' : 'var(--olive-hi)'};"></div></div>
      </div>
      <div class="row">
        <button class="nav-btn btn-blue btn-small grow" onclick="openQrModal()">Share Team</button>
        <button class="nav-btn btn-red btn-small grow" onclick="garageDeleteTeam()">Delete Team</button>
      </div>
    </div>
  </div>`;

  html += `<div class="card"><h2 class="card-title">Vehicles (${team.roster.length})</h2>`;
  if (!team.roster.length) html += `<div class="muted small">No vehicles yet. Add one below.</div>`;
  html += team.roster.map((v, i) => vehicleCardHtml(team, v, i)).join('');
  html += `</div>`;

  html += `<div class="card">
    <h2 class="card-title">Add Vehicle</h2>
    <div class="modal-stack">
      <select id="g-new-type" onchange="garageNewType = this.value; document.getElementById('g-new-type-info').innerHTML = typeInfoHtml(this.value);" aria-label="Vehicle type" style="color:var(--yellow);">${chassisOptions(garageNewType)}</select>
      <div id="g-new-type-info" class="info-box" style="color:var(--text);">${typeInfoHtml(garageNewType)}</div>
      <input type="text" id="g-new-name" placeholder="Name (optional, defaults to the type)" aria-label="Vehicle name">
      <button class="nav-btn" onclick="garageAddVehicle()">+ Add Vehicle</button>
    </div>
  </div>`;

  root.innerHTML = html;
}

function vehicleCardHtml(team, v, i) {
  const open = i === garageExpanded;
  const perkCount = (v.perks || []).length;
  const head = `<button class="veh-head" onclick="garageToggleVehicle(${i})" aria-expanded="${open}">
      <span style="flex:1; min-width:0;">
        <span class="roster-name">${esc(v.name)}</span>${v.hull <= 0 ? ' <span class="tag-wreck">WRECKED</span>' : ''}<br>
        <span class="roster-meta">${esc(v.type)} · ${esc(v.weight)} · ${v.items.length} item${v.items.length === 1 ? '' : 's'}${perkCount ? ` · ${perkCount} perk${perkCount === 1 ? '' : 's'}` : ''}</span>
      </span>
      <span class="roster-cost">${v.cost} C</span>
      <span class="chev">${open ? '▴' : '▾'}</span>
    </button>`;
  if (!open) return `<div class="veh-card" id="veh-card-${i}">${head}</div>`;

  const items = v.items.length
    ? v.items.map((it, idx) => itemRowHtml(team, v, i, it, idx)).join('')
    : '<div class="muted small">Nothing equipped.</div>';

  const s = sponsorOf(team);
  const perks = (v.perks || []).map((id, idx) => {
    const p = findPerk(id);
    if (!p) return '';
    const warn = perkAllowed(p, team) ? '' : ` <span style="color:var(--danger);">not a ${esc(sponsorLabel(team))} perk class</span>`;
    return `<div class="item-row">
        <div style="flex:1; min-width:0;"><b>${esc(p.name)}</b><div class="small muted">${esc(p.perk_class)} · ${p.cost} C${warn}</div><div class="small" style="color:#bbb;">${esc(p.description)}</div></div>
        <button class="x-btn" onclick="garageRemovePerk(${i}, ${idx})" aria-label="Remove ${esc(p.name)}">✕</button>
      </div>`;
  }).join('') || '<div class="muted small">No perks.</div>';
  const available = s ? db.perks.filter(p => s.perk_classes.includes(p.perk_class) && !(v.perks || []).includes(p.id)) : [];
  const perkAdd = !s
    ? '<div class="muted small">Pick a sponsor to buy perks.</div>'
    : available.length
      ? `<div class="row"><select id="g-perk-${i}" class="grow" aria-label="Perk to add">${s.perk_classes.map(c => {
          const list = available.filter(p => p.perk_class === c);
          return list.length ? `<optgroup label="${esc(c)}">${list.map(p => `<option value="${p.id}">${esc(p.name)} (${p.cost} C)</option>`).join('')}</optgroup>` : '';
        }).join('')}</select><button class="nav-btn btn-small" onclick="garageAddPerk(${i})">Add</button></div>`
      : '<div class="muted small">All available perks bought.</div>';

  return `<div class="veh-card open" id="veh-card-${i}">${head}
    <div class="veh-body modal-stack">
      <div>
        <label class="field-label" for="g-vname-${i}">Name</label>
        <input type="text" id="g-vname-${i}" value="${esc(v.name)}" onchange="garageRenameVehicle(${i}, this.value)">
      </div>
      <div>
        <label class="field-label" for="g-vtype-${i}">Vehicle type</label>
        <select id="g-vtype-${i}" onchange="garageChangeType(${i}, this.value)">${chassisOptions(v.typeId)}</select>
      </div>
      <div class="stat-strip">
        <span>Hull<b>${v.maxHull}</b></span><span>Hand<b>${v.handling}</b></span><span>Gear<b>${v.maxGear}</b></span><span>Crew<b>${v.crew}</b></span><span>Slots<b style="color:${usedSlots(v, team) > v.slots ? 'var(--danger)' : 'var(--yellow)'};">${usedSlots(v, team)}/${v.slots}</b></span>
      </div>
      ${v.special ? `<div class="small muted">Special: ${esc(v.special)}</div>` : ''}

      <div class="section-label">Weapons &amp; Upgrades</div>
      ${items}
      <select id="g-item-${i}" onchange="garageLastItem = this.value; document.getElementById('g-item-info-${i}').innerHTML = itemInfoHtml(this.value, currentTeam());" aria-label="Weapon or upgrade to add">${itemOptions(team, v, garageLastItem)}</select>
      <div id="g-item-info-${i}" class="info-box">${itemInfoHtml(garageLastItem, team)}</div>
      <button class="nav-btn" onclick="garageAddItem(${i})">+ Add Weapon / Upgrade</button>

      <div class="section-label">Perks</div>
      ${perks}
      ${perkAdd}

      <div class="row" style="border-top:1px dashed var(--border); padding-top:10px; margin-top:4px;">
        <button class="nav-btn btn-grey btn-small grow" onclick="garageDuplicateVehicle(${i})">Duplicate</button>
        <button class="nav-btn btn-red btn-small grow" onclick="garageDeleteVehicle(${i})">Delete Vehicle</button>
      </div>
    </div>
  </div>`;
}

function itemRowHtml(team, v, i, it, idx) {
  const found = findItem(it.id);
  if (!found) return '';
  const d = found.data;
  const stats = found.kind === 'weapon' ? `${d.attack_dice}D6 ${esc(d.range)} · ` : '';
  const slots = itemSlots(d, team, v);
  const facing = found.kind === 'weapon' && d.category === 'vehicle'
    ? `<select class="facing-select" onchange="garageSetFacing(${i}, ${idx}, this.value)" aria-label="Facing for ${esc(d.name)}">${['Front', 'Rear', 'Side', '360'].map(f => `<option${f === it.facing ? ' selected' : ''}>${f}</option>`).join('')}</select>`
    : '';
  return `<div class="item-row">
      <div style="flex:1; min-width:0;"><b>${esc(d.name)}</b><div class="small muted">${stats}${slots} slot${slots === 1 ? '' : 's'} · ${itemCost(d, team)} C${it.ammo != null ? ` · Ammo ${it.ammo}` : ''}</div></div>
      ${facing}
      <button class="x-btn" onclick="garageRemoveItem(${i}, ${idx})" aria-label="Remove ${esc(d.name)}">✕</button>
    </div>`;
}

// ----- Teams -----

function garageAddTeam() {
  teams.push(newTeam(`Team ${teams.length + 1}`, 'none'));
  currentTeamIndex = teams.length - 1;
  currentVehicleIndex = 0;
  garageExpanded = -1;
  garageAfterChange();
  const name = document.getElementById('g-team-name');
  if (name) { name.focus(); name.select(); }
}

function garageRenameTeam(val) {
  val = val.trim();
  if (val) currentTeam().teamName = val;
  garageAfterChange();
}

function garageSetSponsor(sponsorId) {
  const team = currentTeam();
  team.sponsor = sponsorId;
  // Sponsor changes can alter costs (N2O Addict, Crew Quarters) and slots (Spiked Fist).
  team.roster.forEach(v => recalcVehicle(v, team));
  const problems = rosterProblems(team);
  if (problems.length) alert("Roster no longer fits this sponsor's rules:\n\n• " + problems.join("\n• "));
  garageAfterChange();
}

function garageSetCanCap(val) {
  const n = parseInt(val);
  if (!isNaN(n) && n >= 0) maxCans = n;
  garageAfterChange();
}

function garageDeleteTeam() {
  const team = currentTeam();
  const n = team.roster.length;
  if (!confirm(`Delete ${team.teamName}${n ? ` and its ${n} vehicle${n === 1 ? '' : 's'}` : ''}? This can't be undone.`)) return;
  teams.splice(currentTeamIndex, 1);
  if (!teams.length) teams.push(newTeam('Team 1', 'none'));
  currentTeamIndex = Math.max(0, currentTeamIndex - 1);
  currentVehicleIndex = 0;
  garageExpanded = -1;
  garageAfterChange();
}

// ----- Vehicles -----

function garageToggleVehicle(i) {
  garageExpanded = garageExpanded === i ? -1 : i;
  currentVehicleIndex = i;
  garageAfterChange();
}

function garageAddVehicle() {
  const team = currentTeam();
  const t = vehicleType(document.getElementById('g-new-type').value);
  const name = document.getElementById('g-new-name').value.trim() || t.name;
  const problems = vehicleProblems(team, t, -1);
  if (problems.length && !confirm("This breaks the team-building rules:\n\n• " + problems.join("\n• ") + "\n\nAdd it anyway?")) return;

  team.roster.push(makeVehicle(t.id, name));
  garageNewType = t.id;
  currentVehicleIndex = team.roster.length - 1;
  garageExpanded = currentVehicleIndex;
  garageAfterChange();
  if (calculateTotalCansSpent() > maxCans) alert(`Over the can cap: ${calculateTotalCansSpent()} / ${maxCans} Cans.`);
  const el = document.getElementById('veh-card-' + currentVehicleIndex);
  if (el) el.scrollIntoView({ block: 'start' });
}

function garageRenameVehicle(i, val) {
  val = val.trim();
  if (val) currentTeam().roster[i].name = val;
  garageAfterChange();
}

function garageChangeType(i, typeId) {
  const team = currentTeam();
  const v = team.roster[i];
  const t = vehicleType(typeId);
  const problems = vehicleProblems(team, t, i);
  if (problems.length && !confirm("This breaks the team-building rules:\n\n• " + problems.join("\n• ") + "\n\nChange it anyway?")) { renderGarage(); return; }
  if (v.name === v.type) v.name = t.name;
  v.typeId = t.id;
  recalcVehicle(v, team);
  garageAfterChange();
}

function garageDuplicateVehicle(i) {
  const team = currentTeam();
  const copy = JSON.parse(JSON.stringify(team.roster[i]));
  copy.name = copy.name + ' (copy)';
  copy.gear = 1;
  copy.hazard = 0;
  copy.onFire = false;
  copy.gatesPassed = 0;
  copy.scenarioPoints = 0;
  copy.hull = copy.maxHull;
  copy.items.forEach(it => { const f = findItem(it.id); if (f) it.ammo = itemAmmo(f.data, team); });
  team.roster.splice(i + 1, 0, copy);
  currentVehicleIndex = garageExpanded = i + 1;
  garageAfterChange();
}

function garageDeleteVehicle(i) {
  const team = currentTeam();
  if (!confirm(`Delete ${team.roster[i].name}? This can't be undone.`)) return;
  team.roster.splice(i, 1);
  currentVehicleIndex = Math.max(0, Math.min(currentVehicleIndex, team.roster.length - 1));
  garageExpanded = -1;
  garageAfterChange();
}

// ----- Weapons, upgrades and perks -----

function garageAddItem(i) {
  const team = currentTeam();
  const v = team.roster[i];
  const it = findItem(document.getElementById('g-item-' + i).value);
  if (!it) return;
  garageLastItem = it.data.id;

  const problems = itemProblems(it, team, v);
  if (problems.length && !confirm("This breaks the build rules:\n\n• " + problems.join("\n• ") + "\n\nAdd it anyway?")) return;

  let facing = '';
  if (it.kind === 'weapon' && it.data.category === 'vehicle') {
    facing = /360/.test(it.data.special) || /Turret/.test(v.special) ? '360' : 'Front';
  }
  v.items.push({ id: it.data.id, facing: facing, ammo: itemAmmo(it.data, team) });
  recalcVehicle(v, team);
  garageAfterChange();
}

function garageSetFacing(i, idx, val) {
  currentTeam().roster[i].items[idx].facing = val;
  garageAfterChange();
}

function garageRemoveItem(i, idx) {
  const team = currentTeam();
  const v = team.roster[i];
  v.items.splice(idx, 1);
  recalcVehicle(v, team);
  garageAfterChange();
}

function garageAddPerk(i) {
  const team = currentTeam();
  const v = team.roster[i];
  const p = findPerk(document.getElementById('g-perk-' + i).value);
  if (!p) return;
  v.perks = v.perks || [];
  if (!v.perks.includes(p.id)) v.perks.push(p.id);
  recalcVehicle(v, team);
  garageAfterChange();
}

function garageRemovePerk(i, idx) {
  const team = currentTeam();
  const v = team.roster[i];
  v.perks.splice(idx, 1);
  recalcVehicle(v, team);
  garageAfterChange();
}

function itemProblems(it, team, v) {
  const d = it.data, p = [];
  const desc = itemText(d);
  if (itemSlots(d, team, v) + usedSlots(v, team) > v.slots) p.push(`Not enough build slots (${usedSlots(v, team)}/${v.slots} used).`);
  if (d.once_only && v.items.some(i => i.id === d.id)) p.push(`${d.name} can only be taken once per vehicle.`);
  if (/Not Lightweight/.test(desc) && v.weight === 'Lightweight') p.push(`${d.name} cannot go on a Lightweight vehicle.`);
  if (/Middleweight only\./.test(desc) && v.weight !== 'Middleweight') p.push(`${d.name}: Middleweight vehicles only.`);
  if (/Middleweight\/Heavyweight vehicles only/.test(desc) && v.weight === 'Lightweight') p.push(`${d.name}: Middleweight or Heavyweight vehicles only.`);
  if (/^Heavyweight vehicles only/.test(desc) && v.weight !== 'Heavyweight') p.push(`${d.name}: Heavyweight vehicles only.`);
  if (d.id === 'tank_tracks' && ['tank', 'helicopter', 'gyrocopter'].includes(v.typeId)) p.push('Tank Tracks: not for Tanks, Helicopters or Gyrocopters.');
  if (d.id === 'extra_crew') {
    const t = vehicleType(v.typeId);
    if (v.crew + 1 > t.crew * 2) p.push(`Extra Crewmember: crew can be at most twice the starting Crew (${t.crew * 2}).`);
  }
  if (d.category === 'crew' && d.id !== 'handgun') {
    const crewWeapons = v.items.filter(i => { const x = findItem(i.id); return x && x.data.category === 'crew' && x.data.id !== 'handgun'; }).length;
    if (crewWeapons + 1 > v.crew) p.push(`Each crewmember can carry one crew weapon (${v.crew} crew).`);
  }
  return p;
}

// ---------- Share ----------

function openQrModal() {
  const jsonString = JSON.stringify(currentTeam());
  const textArea = document.getElementById('qr-text-data');
  textArea.value = jsonString;

  const qrImg = document.getElementById('qr-img');
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(jsonString)}`;

  document.getElementById('qr-modal').style.display = 'flex';
}

function closeQrModal() {
  document.getElementById('qr-modal').style.display = 'none';
}

// ---------- Save / load ----------

function saveData() {
  const gameState = {
    version: 2,
    phase: currentPhase,
    round: currentRound,
    maxCans: maxCans,
    scenario: currentScenario,
    votesEnabled: votesEnabled,
    votesVariant: votesVariant,
    tIndex: currentTeamIndex,
    vIndex: currentVehicleIndex,
    teams: teams
  };
  localStorage.setItem('gaslandsTacticalFlowSave', JSON.stringify(gameState));
}

// Upgrades teams saved by older versions (sponsor names, hard-coded chassis, per-vehicle votes, `weapons`, no `perks`).
function normalizeTeam(t) {
  t = t || {};
  let sponsor = t.sponsor || 'none';
  if (!db.sponsors.some(s => s.id === sponsor)) {
    const match = db.sponsors.find(s => s.name.toLowerCase() === String(sponsor).toLowerCase() || s.name.toLowerCase().startsWith(String(sponsor).toLowerCase()));
    sponsor = match ? match.id : 'none';
  }
  const team = { teamName: t.teamName || 'Team', sponsor: sponsor, votes: t.votes || 0, roster: [] };
  (t.roster || []).forEach(old => {
    if (old.typeId && vehicleType(old.typeId) && Array.isArray(old.items)) {
      old.perks = Array.isArray(old.perks) ? old.perks.filter(findPerk) : [];
      recalcVehicle(old, team);
      team.roster.push(old);
      return;
    }
    const type = db.vehicles.find(x => x.name.toLowerCase() === String(old.type || 'car').toLowerCase()) || vehicleType('car');
    const v = makeVehicle(type.id, old.name);
    v.gear = old.gear || 1;
    v.hazard = old.hazard || 0;
    v.gatesPassed = old.gatesPassed || 0;
    v.scenarioPoints = old.scenarioPoints || 0;
    team.votes += old.votes || 0;
    (old.weapons || []).forEach(w => {
      const d = db.weapons.find(x => x.name === w.name) || db.upgrades.find(x => x.name === w.name);
      if (d) v.items.push({ id: d.id, facing: '', ammo: itemAmmo(d, team) });
    });
    recalcVehicle(v, team);
    v.hull = Math.min(v.maxHull, old.hull == null ? v.maxHull : old.hull);
    team.roster.push(v);
  });
  return team;
}

function loadData() {
  let gameState = null;
  try { gameState = JSON.parse(localStorage.getItem('gaslandsTacticalFlowSave')); } catch (e) {}
  firstRun = !gameState;
  if (gameState) {
    currentPhase = gameState.phase || 1;
    currentRound = gameState.round || 1;
    maxCans = gameState.maxCans || 50;
    currentScenario = gameState.scenario || 'death_race';
    if (currentScenario !== 'free_play' && !db.scenarios.some(s => s.id === currentScenario)) currentScenario = 'free_play';
    votesEnabled = gameState.votesEnabled || false;
    votesVariant = gameState.votesVariant || 'peer';
    teams = (gameState.teams || []).map(normalizeTeam);
    currentTeamIndex = Math.min(gameState.tIndex || 0, Math.max(0, teams.length - 1));
    currentVehicleIndex = gameState.vIndex || 0;
    if (!teams[currentTeamIndex] || !teams[currentTeamIndex].roster[currentVehicleIndex]) currentVehicleIndex = 0;
  }
}

window.onload = initApp;
