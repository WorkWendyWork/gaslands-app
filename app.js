    let currentPhase = 1;
    let maxCans = 50;
    let currentScenario = 'death_race';
    let votesEnabled = false;
    let votesVariant = 'peer';
    let currentTeamIndex = 0;
    let currentVehicleIndex = 0;

    let teams = [
      {
        teamName: "Team 1",
        sponsor: "None",
        bonus: "Standard independent rules.",
        roster: [
          { name: "Scrap Car", type: "Car", cost: 12, gear: 1, hazard: 0, hull: 10, handling: 3, crew: 2, slots: 2, votes: 0, shields: 0, chainedTo: null, momentumPool: 0, gatesPassed: 0, scenarioPoints: 0, weapons: [] }
        ]
      }
    ];

    const rulesData = {
      "Game_Setup": {
        category: "setup",
        prompt: "<b>MATCH SETUP: CAN CAP & SCENARIO</b><br><br>Configure your match rules and objectives:<br><br><input type='number' id='can-input' value='50' style='font-size:20px; width:100px; text-align:center; padding:8px; border-radius:4px; border:2px solid #4a5c46; background-color:#1a1e19; color:#8fce00;'><br><br><select id='scenario-select' style='width:100%; padding:8px; box-sizing:border-box; background:#1a1e19; color:#8fce00; border:2px solid #4a5c46; font-size:14px; margin-bottom:10px;'><option value='death_race'>Scenario: Death Race (Gate & Lap Tracker)</option><option value='wasteland_war'>Scenario: Wasteland War (Kill / Survival Points)</option><option value='free_play'>Scenario: Free Play / Custom</option></select><br><label style='font-size:14px; cursor:pointer;'><input type='checkbox' id='votes-toggle' style='transform:scale(1.2); margin-right:8px;'> Enable Audience Votes</label><br><br><select id='votes-variant' style='width:100%; padding:8px; box-sizing:border-box; background:#1a1e19; color:#8fce00; border:2px solid #4a5c46; font-size:14px;'><option value='peer'>Variant: Peer Voting</option><option value='objective'>Variant: Objective-Based</option><option value='marshal'>Variant: Full Marshal</option></select>",
        options: [
          { text: "Start Match", next: "Turn_Start" }
        ]
      },
      "Turn_Start": {
        category: "movement",
        prompt: "<b>GEAR PHASE [PHASE] : TURN START</b><br><br>1. Check Gear eligibility.<br>2. Shift Gear up or down by 1 if desired.<br>3. Select movement template.<br><br>Are you ready to execute your movement?",
        options: [
          { text: "Proceed to Movement", next: "Perform_Movement" },
          { text: "View Weapon Armory", next: "Weapon_Tracker" }
        ]
      },
      "Perform_Movement": {
        category: "movement",
        prompt: "<b>PERFORM MOVEMENT STEP</b><br><br>1. Place selected template.<br>2. Roll Skid Dice equal to your Handling stat.<br>3. Resolve Shift, Slide, Spin, or Hazard results.<br><br>Did your vehicle collide with another car or side obstacle?",
        options: [
          { text: "Yes (Resolve Collision)", next: "Check_Collision" },
          { text: "No (Movement Clean)", next: "Wipeout_Phase_Check" }
        ]
      },
      "Check_Collision": {
        category: "combat",
        prompt: "<b>COLLISION DETECTED</b><br><br>Determine collision orientation: Head-On, T-Bone, or Tailgate. Declare Smash or Evade reactions.",
        options: [
          { text: "Resolve Smash Attack", next: "Roll_Attacks" },
          { text: "Check Pinball Perk (Slime)", next: "Check_Pinball" }
        ]
      },
      "Check_Pinball": {
        category: "combat",
        prompt: "<b>SLIME PINBALL CHECK</b><br><br>Check if side-to-side Smash collision triggers extra movement.",
        options: [
          { text: "Take Bonus Movement Step", next: "Pinball_Active" },
          { text: "Continue Normal Flow", next: "Wipeout_Phase_Check" }
        ]
      },
      "Pinball_Active": {
        category: "combat",
        prompt: "<b>PINBALL ACTIVE</b><br><br>Execute free extra movement step granted by Slime sponsor perk.",
        options: [
          { text: "Proceed to Attack / Combat", next: "Roll_Attacks" }
        ]
      },
      "Roll_Attacks": {
        category: "combat",
        prompt: "<b>STEP 5: Roll Smash Attack / Shooting Dice</b><br><br>Roll attack dice (4+ is a hit, 6 is a Critical / two hits).<br><br>[RUTHERFORD_MODIFIER]",
        options: [
          { text: "Proceed to Evade Check", next: "Roll_Evade" }
        ]
      },
      "Roll_Evade": {
        category: "combat",
        prompt: "<b>STEP 6: Evade Check</b><br><br>Target rolls Evade dice equal to current Gear (6 cancels a hit). Remaining hits become damage.",
        options: [
          { text: "Apply Hits / Damage", next: "Apply_Damage" }
        ]
      },
      "Apply_Damage": {
        category: "combat",
        prompt: "<b>APPLY DAMAGE</b><br><br>Enter incoming damage hits to apply against shields and hull:",
        options: [
          { text: "Proceed to Wipeout Check", next: "Wipeout_Phase_Check" }
        ]
      },
      "Wipeout_Phase_Check": {
        category: "wipeout",
        prompt: "<b>WIPEOUT CHECK STEP</b><br><br>Do you currently have 6 or more Hazard Tokens?",
        options: [
          { text: "Yes (Trigger Wipeout)", next: "Wipeout_Flip_Check" },
          { text: "No (End Activation Safely)", next: "End_Activation" }
        ]
      },
      "Wipeout_Flip_Check": {
        category: "wipeout",
        prompt: "<b>WIPEOUT FLIP CHECK</b><br><br>[GEAR_CHECK_TEXT]",
        options: [
          { text: "Pass Flip Check", next: "Wipeout_Flip_Pass" },
          { text: "Fail Flip Check", next: "Wipeout_Flip_Fail" }
        ]
      },
      "Wipeout_Flip_Pass": {
        category: "wipeout",
        prompt: "<b>WIPEOUT PASSED / CONTROL REGAINED</b><br><br>Discard hazard tokens down to safe levels and continue race.",
        options: [
          { text: "End Activation", next: "End_Activation" }
        ]
      },
      "Wipeout_Flip_Fail": {
        category: "wipeout",
        prompt: "<b>WIPEOUT FAILED: VEHICLE WRECKED</b><br><br>Vehicle suffers severe crash, drops to Gear 1, and takes critical damage.",
        options: [
          { text: "End Activation", next: "End_Activation" }
        ]
      },
      "End_Activation": {
        category: "movement",
        prompt: "<b>ACTIVATION COMPLETE</b><br><br>Pass control to the next vehicle activation in the current Gear Phase.",
        options: [
          { text: "Return to Turn Start", next: "Turn_Start" }
        ]
      },
      "Weapon_Tracker": {
        category: "combat",
        prompt: "<b>ARMORY & WEAPON MANAGEMENT</b><br><br>Manage weapon mounts, ammo tokens, and firing arcs for this vehicle.",
        options: [
          { text: "Back to Turn Start", next: "Turn_Start" }
        ]
      }
    };

    function initApp() {
      loadData();
      updateTeamDropdown();
      updateVehicleDropdown();
      refreshTrackerUI();
      loadNode("Turn_Start");
    }

    function switchTeam(index) {
      currentTeamIndex = parseInt(index);
      currentVehicleIndex = 0;
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
        opt.innerText = t.teamName + ` (${t.sponsor})`;
        if (i === currentTeamIndex) opt.selected = true;
        select.appendChild(opt);
      });
    }

    function updateVehicleDropdown() {
      const select = document.getElementById('vehicle-select');
      select.innerHTML = '';
      const currentTeam = teams[currentTeamIndex];
      if (!currentTeam || !currentTeam.roster) return;
      
      currentTeam.roster.forEach((v, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.innerText = v.name + ` [${v.type}] (Hull: ${v.hull})`;
        if (i === currentVehicleIndex) opt.selected = true;
        select.appendChild(opt);
      });
    }

    function editTeamName() {
      const currentTeam = teams[currentTeamIndex];
      if (!currentTeam) return;

      const newName = prompt("Enter a new name for this team:", currentTeam.teamName);
      if (newName && newName.trim() !== "") {
        currentTeam.teamName = newName.trim();
        updateTeamDropdown();
        refreshTrackerUI();
        saveData();
        alert(`Team name successfully updated to "${currentTeam.teamName}"!`);
      }
    }

    function addTeam() {
      const name = prompt("Enter new team name (e.g., Wasteland Raiders):", "Team " + (teams.length + 1));
      if (!name) return;
      
      const sponsorChoice = prompt("Choose a Sponsor:\n1. Mishkin (Shields)\n2. Rutherford (Re-roll 1s)\n3. Slime (Pinball)\n4. Warden (Chain Gang)\n5. Idris (Momentum)\n6. Grandma's Boyz (Repairs)\n7. Scrap Iron (Salvage)\n8. Highway Knights (Charges)\n9. Inquisitors (Targeting)\n10. None", "Mishkin");
      
      let sponsorName = "None";
      let sponsorBonus = "Standard independent rules.";
      
      const choice = (sponsorChoice || "").toLowerCase();
      if (choice.includes("mish")) {
        sponsorName = "Mishkin";
        sponsorBonus = "Energy shields active (3 buffer points).";
      } else if (choice.includes("ruth")) {
        sponsorName = "Rutherford";
        sponsorBonus = "Heavy metal focus; re-roll natural 1s on attack dice.";
      } else if (choice.includes("slim")) {
        sponsorName = "Slime";
        sponsorBonus = "Pinball perk active: side Smash collisions grant bonus movement.";
      } else if (choice.includes("ward")) {
        sponsorName = "The Warden";
        sponsorBonus = "Prison chain gang: vehicles can share momentum & hazards.";
      } else if (choice.includes("idris")) {
        sponsorName = "Idris";
        sponsorBonus = "Momentum master: keep extra gear momentum between turns.";
      } else if (choice.includes("grandma") || choice.includes("boyz")) {
        sponsorName = "Grandma's Boyz";
        sponsorBonus = "Home cooking: enhanced crew repair and resilience.";
      } else if (choice.includes("scrap")) {
        sponsorName = "Scrap Iron";
        sponsorBonus = "Scavenger economy: bonus cans from destroyed wrecks.";
      } else if (choice.includes("highway") || choice.includes("knight")) {
        sponsorName = "Highway Knights";
        sponsorBonus = "Chivalric charge: bonus dice when initiating head-on rams.";
      } else if (choice.includes("inquisitor")) {
        sponsorName = "The Inquisitors";
        sponsorBonus = "Fanatical purge: targeted enemy vehicles take extra hazard stress.";
      }

      teams.push({
        teamName: name,
        sponsor: sponsorName,
        bonus: sponsorBonus,
        roster: [
          { name: "Scrap Car", type: "Car", cost: 12, gear: 1, hazard: 0, hull: 10, handling: 3, crew: 2, slots: 2, votes: 0, shields: sponsorName === "Mishkin" ? 3 : 0, chainedTo: null, momentumPool: sponsorName === "Idris" ? 2 : 0, gatesPassed: 0, scenarioPoints: 0, weapons: [] }
        ]
      });
      
      currentTeamIndex = teams.length - 1;
      currentVehicleIndex = 0;
      
      updateTeamDropdown();
      updateVehicleDropdown();
      refreshTrackerUI();
      saveData();
    }

    function addNewVehicle() {
      const vName = prompt("Enter vehicle name:", "Interceptor " + (teams[currentTeamIndex].roster.length + 1));
      if (!vName) return;
      
      const vType = prompt("Choose Chassis (Buggy, Car, Truck, Tank):", "Car");
      let hull = 10, handling = 3, slots = 2;
      const typeLower = (vType || "").toLowerCase();
      if (typeLower.includes("buggy")) { hull = 6; handling = 4; slots = 2; }
      else if (typeLower.includes("truck")) { hull = 14; handling = 2; slots = 3; }
      else if (typeLower.includes("tank")) { hull = 20; handling = 2; slots = 4; }

      const currentTeam = teams[currentTeamIndex];
      currentTeam.roster.push({
        name: vName,
        type: vType || "Car",
        cost: 12,
        gear: 1,
        hazard: 0,
        hull: hull,
        handling: handling,
        crew: 2,
        slots: slots,
        votes: 0,
        shields: currentTeam.sponsor === "Mishkin" ? 3 : 0,
        chainedTo: null,
        momentumPool: currentTeam.sponsor === "Idris" ? 2 : 0,
        gatesPassed: 0,
        scenarioPoints: 0,
        weapons: []
      });

      currentVehicleIndex = currentTeam.roster.length - 1;
      updateVehicleDropdown();
      refreshTrackerUI();
      saveData();
    }

    function updateStat(type, amount) {
      const currentTeam = teams[currentTeamIndex];
      const v = currentTeam.roster[currentVehicleIndex];
      if (!v) return;

      if (type === 'gear') {
        v.gear = Math.max(1, Math.min(6, v.gear + amount));
      } else if (type === 'hazard') {
        v.hazard = Math.max(0, v.hazard + amount);
        if (v.hazard >= 6) {
          if (confirm("Hazard threshold (6+) reached! Trigger Wipeout check?")) {
            loadNode("Wipeout_Flip_Check");
          }
        }
      } else if (type === 'hull') {
        v.hull = Math.max(0, v.hull + amount);
      } else if (type === 'votes') {
        v.votes = Math.max(0, v.votes + amount);
      } else if (type === 'shields') {
        v.shields = Math.max(0, (v.shields || 0) + amount);
      }
      refreshTrackerUI();
      saveData();
    }

    function updateScenarioProgress(amount) {
      const currentTeam = teams[currentTeamIndex];
      const v = currentTeam.roster[currentVehicleIndex];
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
      let total = 0;
      teams[currentTeamIndex].roster.forEach(v => {
        total += (v.cost || 12);
      });
      return total;
    }

    function refreshTrackerUI() {
      const currentTeam = teams[currentTeamIndex];
      const v = currentTeam.roster[currentVehicleIndex];
      if (!v) return;
      
      document.getElementById('gear-display').innerText = v.gear;
      document.getElementById('hazard-display').innerText = v.hazard;
      document.getElementById('hull-display').innerText = v.hull;
      document.getElementById('handling-display').innerText = v.handling;
      document.getElementById('crew-display').innerText = v.crew;
      document.getElementById('slots-display').innerText = v.slots;
      
      const shieldContainer = document.getElementById('shields-tracker-container');
      if (currentTeam.sponsor && currentTeam.sponsor.toLowerCase().includes('mishkin')) {
        if (shieldContainer) shieldContainer.style.display = 'flex';
        if (v.shields === undefined) v.shields = 3;
        document.getElementById('shields-display').innerText = v.shields;
      } else {
        if (shieldContainer) shieldContainer.style.display = 'none';
      }

      const wardenContainer = document.getElementById('warden-chain-container');
      if (currentTeam.sponsor && currentTeam.sponsor.toLowerCase().includes('warden')) {
        if (wardenContainer) wardenContainer.style.display = 'flex';
        document.getElementById('chain-display').innerText = v.chainedTo ? `Linked` : "Free";
      } else {
        if (wardenContainer) wardenContainer.style.display = 'none';
      }
      
      const votesStatElement = document.getElementById('votes-tracker-container');
      if (votesStatElement) {
        votesStatElement.style.display = votesEnabled ? 'flex' : 'none';
        document.getElementById('votes-display').innerText = v.votes;
      }
      
      const sponsorDisplay = document.getElementById('sponsor-display');
      if (sponsorDisplay) sponsorDisplay.innerText = currentTeam.sponsor || "None";

      const sponsorBonusDisplay = document.getElementById('sponsor-bonus-display');
      if (sponsorBonusDisplay) sponsorBonusDisplay.innerText = currentTeam.bonus || "Standard rules.";
      
      const totalSpent = calculateTotalCansSpent();
      document.getElementById('cans-display').innerText = totalSpent + " / " + maxCans + " Cans";

      const goalLabel = document.getElementById('scenario-goal-label');
      const progressDisplay = document.getElementById('scenario-progress-display');
      if (goalLabel && progressDisplay) {
        if (currentScenario === 'death_race') {
          goalLabel.innerText = "Gates Cleared:";
          progressDisplay.innerText = v.gatesPassed || 0;
        } else if (currentScenario === 'wasteland_war') {
          goalLabel.innerText = "Kill / Victory Pts:";
          progressDisplay.innerText = v.scenarioPoints || 0;
        } else {
          goalLabel.innerText = "Custom Objective:";
          progressDisplay.innerText = v.scenarioPoints || 0;
        }
      }
    }

    function loadNode(nodeID) {
      const node = rulesData[nodeID];
      if (!node) return;

      const currentTeam = teams[currentTeamIndex];
      const v = currentTeam.roster[currentVehicleIndex];
      let dynamicText = node.prompt;
      const sponsorLower = (currentTeam.sponsor || "").toLowerCase();

      if (nodeID === 'Resolve_Shooting') {
        if (sponsorLower.includes('rutherford')) {
          dynamicText = dynamicText.replace("[RUTHERFORD_MODIFIER]", "<div style='background:#242220; border:1px solid #ffcc00; padding:10px; margin-top:10px; border-radius:4px;'><span style='color:#ffcc00;'><b>Rutherford Heavy Metal:</b></span><br>Re-roll natural 1s on attack dice.<br><button class='nav-btn' style='margin-top:8px; background-color:#3b3b3b; font-size:14px; padding:10px;' onclick='alert("Rutherford attack 1s re-rolled successfully!")'>Simulate Re-roll 1s</button></div>");
        } else {
          dynamicText = dynamicText.replace("[RUTHERFORD_MODIFIER]", "");
        }
      }

      if (nodeID === 'Check_Pinball') {
        if (sponsorLower.includes('slime')) {
          dynamicText = "<b>Slime Sponsor: Pinball Activated!</b><br><br>Side-to-side Smash collision automatically triggers your Pinball extra movement step!";
          node.options = [{ text: "Take Bonus Movement Step", next: "Pinball_Active" }];
        }
      }

      if (nodeID === 'Wipeout_Flip_Check') {
        if (v.gear === 1) {
          dynamicText = dynamicText.replace("[GEAR_CHECK_TEXT]", "Your current Gear is <b>1</b>. <b>You automatically pass!</b> Safe from wiping out in Gear 1.");
          node.options = [{ text: "Proceed (Safe)", next: "Wipeout_Flip_Pass" }];
        } else {
          dynamicText = dynamicText.replace("[GEAR_CHECK_TEXT]", "Roll <b>1 standard D6</b>.<br><br>Is the result <b>LOWER than " + v.gear + "</b> (yet)?");
          node.options = [
            { text: "Yes (Rolled lower - Fail)", next: "Wipeout_Flip_Fail" },
            { text: "No (Rolled equal or higher - Pass)", next: "Wipeout_Flip_Pass" }
          ];
        }
      }

      if (nodeID === 'Apply_Damage') {
        dynamicText = `<b>APPLY DAMAGE</b><br><br>Current Vehicle: <b>${v.name}</b><br>Shields: ${v.shields || 0} | Hull: ${v.hull}<br><br>Enter incoming damage hits:<br><input type='number' id='hit-input' value='1' style='font-size:18px; width:80px; text-align:center; padding:6px; background:#1a1e19; color:#fff; border:1px solid #4a5c46;'> <button class='nav-btn' style='width:auto; padding:8px 12px; margin-top:5px;' onclick='applyHits()'>Apply Hits</button>`;
      }

      if (nodeID === 'Game_Setup') {
        setTimeout(() => {
          const canInput = document.getElementById('can-input');
          if (canInput) canInput.value = maxCans;
        }, 50);
      }

      dynamicText = dynamicText.replaceAll("[GEAR]", v.gear).replaceAll("[HANDLING]", v.handling).replaceAll("[PHASE]", currentPhase);
      document.getElementById('prompt-text').innerHTML = dynamicText;
      
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';

      node.options.forEach(option => {
        const btn = document.createElement('button');
        btn.className = 'nav-btn';
        btn.innerText = option.text;
        btn.onclick = () => {
          if (nodeID === 'Game_Setup') {
            maxCans = parseInt(document.getElementById('can-input').value) || 50;
            currentScenario = document.getElementById('scenario-select').value;
            votesEnabled = document.getElementById('votes-toggle').checked;
            votesVariant = document.getElementById('votes-variant').value;
            refreshTrackerUI();
            saveData();
          }
          loadNode(option.next);
        };
        btnContainer.appendChild(btn);
      });
    }

    function applyHits() {
      const hitInput = document.getElementById('hit-input');
      let hits = parseInt(hitInput.value) || 0;
      const currentTeam = teams[currentTeamIndex];
      const v = currentTeam.roster[currentVehicleIndex];
      
      if (currentTeam.sponsor && currentTeam.sponsor.toLowerCase().includes('mishkin') && v.shields > 0) {
        if (v.shields >= hits) {
          v.shields -= hits;
          hits = 0;
          alert("Energy shields absorbed all incoming damage!");
        } else {
          hits -= v.shields;
          v.shields = 0;
          alert("Energy shields collapsed! Remaining damage bled through to Hull.");
        }
      }
      
      if (hits > 0) {
        updateStat('hull', -hits);
      }
      
      refreshTrackerUI();
      saveData();
      loadNode("Wipeout_Phase_Check");
    }

    function filterRules(categoryKey) {
      const container = document.getElementById('prompt-text');
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      
      let matchCount = 0;
      let htmlContent = `<b>FILTERED RULES: ${categoryKey.toUpperCase()}</b><br><br><div style='display:flex; flex-direction:column; gap:6px;'>`;
      
      for (const key in rulesData) {
        const node = rulesData[key];
        if (node.category === categoryKey) {
          matchCount++;
          const titleMatch = node.prompt.match(/<b>(.*?)<\/b>/);
          const title = titleMatch ? titleMatch[1] : key;
          
          const btn = document.createElement('button');
          btn.className = 'nav-btn';
          btn.style.padding = '10px';
          btn.style.fontSize = '13px';
          btn.style.marginBottom = '4px';
          btn.innerText = title.replace(/<[^>]*>?/gm, '');
          btn.onclick = () => loadNode(key);
          btnContainer.appendChild(btn);
        }
      }
      
      if (matchCount === 0) {
        htmlContent += "No rules found in this category.";
      }
      htmlContent += "</div>";
      container.innerHTML = htmlContent;

      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showChassisDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      const chassisData = [
        { name: "Bike", weight: "Light", hull: 4, handling: 5, slots: 1, cans: 4 },
        { name: "Buggy", weight: "Light", hull: 6, handling: 4, slots: 2, cans: 8 },
        { name: "Car", weight: "Middle", hull: 10, handling: 3, slots: 2, cans: 12 },
        { name: "Truck", weight: "Middle", hull: 12, handling: 2, slots: 3, cans: 16 },
        { name: "Tank", weight: "Heavy", hull: 20, handling: 2, slots: 4, cans: 30 }
      ];
      let htmlContent = "<b>OFFICIAL CHASSIS DIRECTORY</b><br><br><div style='display:flex; flex-direction:column; gap:6px;'>";
      chassisData.forEach(c => {
        htmlContent += `<div style='background:#141714; padding:8px; border:1px solid #4a3c28; border-radius:4px; font-size:13px;'><span style='color:#ffcc00; font-weight:bold;'>${c.name}</span> (${c.weight})<br><span style='color:#00cc66;'>Hull: ${c.hull} | Handl: ${c.handling} | Slots: ${c.slots} | ${c.cans} Cans</span></div>`;
      });
      htmlContent += "</div>";
      document.getElementById('prompt-text').innerHTML = htmlContent;
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showWeaponDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      const weaponData = [
        { name: "Machine Gun", slots: 1, ammo: 3, cans: 2, desc: "Range 12", 3 dice (4+ to hit)." },
        { name: "Heavy Machine Gun", slots: 2, ammo: 3, cans: 4, desc: "Range 18", 4 dice." },
        { name: "Flamethrower", slots: 1, ammo: 3, cans: 4, desc: "Template weapon, 6 dice." },
        { name: "Minigun", slots: 2, ammo: 5, cans: 6, desc: "Range 12", 6 dice." }
      ];
      let htmlContent = "<b>OFFICIAL ARMORY INDEX</b><br><br><div style='display:flex; flex-direction:column; gap:6px;'>";
      weaponData.forEach(w => {
        htmlContent += `<div style='background:#141714; padding:8px; border:1px solid #4a3c28; border-radius:4px; font-size:13px;'><span style='color:#ffcc00; font-weight:bold;'>${w.name}</span> (${w.cans} Cans)<br><span style='color:#00cc66;'>Slots: ${w.slots} | Ammo: ${w.ammo}</span><br><span style='color:#aaa; font-size:12px;'>${w.desc}</span></div>`;
      });
      htmlContent += "</div>";
      document.getElementById('prompt-text').innerHTML = htmlContent;
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showScenarioDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      document.getElementById('prompt-text').innerHTML = "<b>SCENARIO INDEX</b><br><br><b>Death Race:</b> Pass gates in sequence.<br><b>Wasteland War:</b> Total vehicular destruction.";
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showSponsorDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      document.getElementById('prompt-text').innerHTML = "<b>SPONSOR INDEX</b><br><br><b>Mishkin:</b> Energy Shields.<br><b>Rutherford:</b> Re-roll 1s.<br><b>Slime:</b> Pinball bounce.<br><b>Warden:</b> Chain Gang.";
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showUniversalRulesDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      document.getElementById('prompt-text').innerHTML = "<b>UNIVERSAL RULES</b><br><br>Gear shifting, hazard thresholds (6+), and audience votes.";
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showVotesDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      document.getElementById('prompt-text').innerHTML = "<b>VOTE ACTIONS</b><br><br><b>Burn Rubber (1):</b> Shift Gear.<br><b>Reload (2):</b> +1 Ammo.<br><b>Respawn (3):</b> Return wrecked car.";
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showCollisionDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      document.getElementById('prompt-text').innerHTML = "<b>COLLISION PHYSICS</b><br><br>Head-on (sum of Gears), T-bone (acting gear), Tailgate (gear difference).";
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showHazardDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      document.getElementById('prompt-text').innerHTML = "<b>HAZARD & SKID DICE</b><br><br>Shift (4-6), Slide (3), Spin (2), Hazard (1).";
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showCoverDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      document.getElementById('prompt-text').innerHTML = "<b>COVER INDEX</b><br><br><b>Hard Cover:</b> -2 attack dice.<br><b>Soft Cover:</b> -1 attack die.";
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showEquipmentDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      document.getElementById('prompt-text').innerHTML = "<b>EQUIPMENT & UPGRADES</b><br><br>Exploding Ram, Armor Plating, Turrets, and Nitrous Boosts.";
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showCampaignDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      document.getElementById('prompt-text').innerHTML = "<b>CAMPAIGN RULES</b><br><br>Post-match salvage, crew members, repairs, and sponsor payouts.";
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function showDrivingDirectory() {
      const btnContainer = document.getElementById('button-container');
      btnContainer.innerHTML = '';
      document.getElementById('prompt-text').innerHTML = "<b>DRIVING & MANEUVERS</b><br><br>Stationary spins in gear 1, slides, hairpin turns, and reversing.";
      const backBtn = document.createElement('button');
      backBtn.className = 'nav-btn';
      backBtn.style.marginTop = '10px';
      backBtn.innerText = "Back to Turn";
      backBtn.onclick = () => loadNode("Turn_Start");
      btnContainer.appendChild(backBtn);
    }

    function saveData() {
      const gameState = {
        phase: currentPhase,
        maxCans: maxCans,
        scenario: currentScenario,
        votesEnabled: votesEnabled,
        votesVariant: votesVariant,
        tIndex: currentTeamIndex,
        vIndex: currentVehicleIndex,
        teams: teams
      };
      localStorage.setItem('gaslandsSave', JSON.stringify(gameState));
    }

    function loadData() {
      const saved = localStorage.getItem('gaslandsSave');
      if (saved) {
        const gameState = JSON.parse(saved);
        currentPhase = gameState.phase || 1;
        maxCans = gameState.maxCans || 50;
        currentScenario = gameState.scenario || 'death_race';
        votesEnabled = gameState.votesEnabled || false;
        votesVariant = gameState.votesVariant || 'peer';
        currentTeamIndex = gameState.tIndex || 0;
        currentVehicleIndex = gameState.vIndex || 0;
        teams = gameState.teams || teams;
      }
    }

    window.onload = initApp;
