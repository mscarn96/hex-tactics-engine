import fs from 'fs';
import { restCost, rationCost } from '@/systems/economy/cityServices';
import { tributeDemand, siegeArmySize, siegePowerScale } from '@/systems/world/tribute';
import { BALANCE } from '@/data/balanceConstants';
import { QUESTS } from '@/quests/questData';
import { questLevelFloor } from '@/systems/quests/questLeads';
import { createRNG } from '@/utils/rng';
import { generateEncounterEnemies } from '@/systems/world/encounterGenerator';
import { neutralDepth, ThreatBand, threatRewardScale } from '@/systems/world/threat';
import { victoryRewards } from '@/systems/combat/combatRewards';
import { tradeRates } from '@/systems/economy/market';
import { buildSimHero, defaultHeroConfig } from '@/systems/sim/simHarness';
import { createEnemyUnits, createPlayerUnits, generateEnemyPositions, generatePlayerPositions } from '@/systems/combat/unitFactory';
import { ResourceType, TileType } from '@/models/types';

/** Explicit victory-income projection, not an automated campaign or an AI win-rate claim. */
it('records seeded income budgets for the approved rest and tribute curves', () => {
  const profiles = [{name:'slow',fights:8,finds:6}, {name:'steady',fights:14,finds:12}, {name:'fast',fights:20,finds:18}];
  const levels=[2,4,6,8,10,12,14,16,18,20];
  const bands: ThreatBand[]=[0,1,1,2,2,3,3,4,4,4];
  const terrain=[TileType.Plains,TileType.Forest,TileType.Desert,TileType.Highlands,TileType.Tundra];
  const nodeTypes=[ResourceType.Wood,ResourceType.Stone,ResourceType.Iron,ResourceType.Crystal];
  const result=[];
  for(const profile of profiles) {
    const rng=createRNG(7319);const random=jest.spyOn(Math,'random').mockImplementation(()=>rng.next());
    const claimed=new Set<string>();const rows=[];
    try {for(let week=1;week<=10;week++) {
      const size=Math.min(4,week+1),level=levels[week-1],band=bands[week-1];
      const heroes=(['warrior','ranger','mage','healer'] as const).slice(0,size).map(id=>buildSimHero(defaultHeroConfig(id,level),()=>'',id)!);
      const players=createPlayerUnits(heroes,generatePlayerPositions(size));
      let fightGold=0,sales=0;
      const rates=tradeRates(week,0);
      for(let fight=0;fight<profile.fights;fight++) {
        const ids=generateEncounterEnemies('random',band,terrain[fight%terrain.length]);
        const enemies=createEnemyUnits(ids,generateEnemyPositions(ids.length),level);
        const rewards=victoryRewards({units:[...players,...enemies],heroes,encounterId:'random',threatBand:band,threatDepth:neutralDepth(band),castleRun:null,isLastStage:false});
        fightGold+=rewards.gold;
        // Sell half of ordinary combat resources, saving half for construction/crafting.
        sales+=rewards.resources.reduce((sum,r)=>sum+Math.floor(r.amount/2)*(rates.find(p=>p.resource===r.type)?.sell??0),0);
      }
      // Finds: every fourth is a purse, the rest are resource caches. Counts are weekly
      // collections, not map totals — three times as many caches as the old nodes, each smaller.
      for(let find=0;find<profile.finds;find++) {
        if(find%4===3) {
          const {min,max}=BALANCE.EXPLORATION_FINDS.GOLD_AMOUNT;
          sales+=Math.round((min+Math.floor(rng.next()*(max-min+1)))*threatRewardScale(band,neutralDepth(band),true));
          continue;
        }
        const type=nodeTypes[find%nodeTypes.length];const range=BALANCE.EXPLORATION_FINDS.RESOURCE_AMOUNTS[type as keyof typeof BALANCE.EXPLORATION_FINDS.RESOURCE_AMOUNTS];
        const amount=range.min+Math.floor(rng.next()*(range.max-range.min+1));
        sales+=Math.floor(amount/2)*(rates.find(p=>p.resource===type)?.sell??0);
      }
      // This budget assumes story prerequisites and objectives completed; inspect
      // the strength floor inside compound gates without pretending to play the campaign.
      const candidates=Object.values(QUESTS).filter(q=>!claimed.has(q.id)&&questLevelFloor(q.id)>0&&questLevelFloor(q.id)<=level*size).sort((a,b)=>(a.rewards.gold??0)-(b.rewards.gold??0)).slice(0,2);
      const questGold=candidates.reduce((sum,q)=>{claimed.add(q.id);return sum+(q.rewards.gold??0);},0);
      const old=week<=2?0:Math.round(100*Math.pow(1.35,week-3)/10)*10;
      const double=week<=2?0:100*Math.pow(2,week-3);
      const piecewise=tributeDemand(week);
      const rest=restCost(0,level*size);const ration=rationCost(0,level*size);
      rows.push({week,level,size,band,fightGold,questGold,sales,income:fightGold+questGold+sales,old,double,piecewise,rest,ration,meanFightGold:Math.round(fightGold/profile.fights),weeklyRestCost:rest*3,siegeSize:siegeArmySize(week),siegePower:siegePowerScale(week)});
    }}finally{random.mockRestore();}
    let purse = 100;
    const budget = rows.map(r => {
      const investment = Math.round(r.income * 0.35);
      // The bill arrives at START of week: only prior weeks can fund it.
      const before = purse, payable = purse >= r.piecewise;
      if (payable) purse -= r.piecewise;
      const after = purse, weeklyRationCost = r.ration * 3;
      purse += r.income - r.weeklyRestCost - weeklyRationCost - investment;
      return {...r,investment,weeklyRationCost,purseBeforeTribute:before,payable,purseAfterTribute:after,endWeekPurse:purse};
    });
    result.push({...profile,rows:budget});
  }
  fs.mkdirSync('coverage/captures/tavern-pricing',{recursive:true});
  fs.writeFileSync('coverage/captures/tavern-pricing/projection.json',JSON.stringify({seed:7319,assumptions:'Victories assumed; no equipment sales, meals or Library bonus. Sell half of find and combat resources; gold purses are kept; up to two level-eligible quest payouts per week, with objectives assumed completed. Three full rests and three rations/week; bills are collected before current-week income. Profiles are budgets, not a measured player journey.',result},null,2)+'\n');
  expect(result.find(p=>p.name==='steady')!.rows.every(r=>r.payable)).toBe(true);
  expect(result.find(p=>p.name==='slow')!.rows.some(r=>!r.payable)).toBe(true);
  expect(result.every(p=>p.rows.every(r=>r.income>0&&r.sales>=0))).toBe(true);
});
