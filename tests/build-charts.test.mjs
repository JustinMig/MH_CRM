import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listBuildCharts, lookupBuildChart, BUILD_CHART_PROVENANCE } from '../build-charts.js';

const names = ['Mutual of Omaha', 'American Amicable', 'Physicians Mutual', 'Corebridge Financial — SimpliNow Legacy'];
const bounds = [[56,82,27],[53,81,29],[56,83,28],[56,82,27]];

test('all 111 saved height rows have a real chart response with source and explicit units', () => {
  const catalogue = listBuildCharts();
  assert.deepEqual(catalogue.map(chart => chart.company), names);
  let count = 0;
  catalogue.forEach((chart, index) => {
    const [first,last,total] = bounds[index];
    assert.equal(chart.heights.length, total);
    assert.equal(chart.heights[0].value, first);
    assert.equal(chart.heights.at(-1).value, last);
    assert.equal(new Set(chart.heights.map(row => row.value)).size, total);
    for (const height of chart.heights) {
      const result = lookupBuildChart({ company: chart.company, heightInches: height.value });
      assert.equal(result.company, chart.company);
      assert.equal(result.heightInches, height.value);
      assert.equal(result.height, height.label);
      assert.ok(Array.isArray(result.values) && result.values.length);
      assert.ok(result.values.every(value => value.label && /^\d+(?:-\d+)? lb$/.test(value.value)));
      assert.match(result.source, /page \d+/);
      assert.equal(result.referenceOnly, true);
      count++;
    }
  });
  assert.equal(count,111);
  assert.equal(BUILD_CHART_PROVENANCE.blob,'28a46f501dd384fb6e8462503998f58be7775977');
  assert.equal(BUILD_CHART_PROVENANCE.latestCarrierRevisionVerified,false);
});

test('6-foot-2 values and product-specific labels match the saved M&M chart references', () => {
  const expected = [['129 lb','321 lb'],['343 lb','344-359 lb','360-374 lb','142 lb','137-141 lb'],['145 lb','319 lb'],['129 lb','354 lb','137 lb','330 lb']];
  names.forEach((company, index) => assert.deepEqual(lookupBuildChart({company,heightInches:74}).values.map(row=>row.value),expected[index]));
  assert.match(lookupBuildChart({company:names[0],heightInches:74}).values[1].label,/TLE, IULE/);
  assert.match(lookupBuildChart({company:names[0],heightInches:74}).warnings.join(' '),/not Living Promise/);
  assert.match(lookupBuildChart({company:names[3],heightInches:74}).values[0].label,/graded/);
  assert.match(lookupBuildChart({company:names[3],heightInches:74}).values[2].label,/level/);
});

test('unusual source bands and Home Office referral heights are preserved, not silently corrected', () => {
  for (const heightInches of [53,54,55]) assert.match(lookupBuildChart({company:names[1],heightInches}).warnings.join(' '),/Refer to Home Office/);
  assert.doesNotMatch(lookupBuildChart({company:names[1],heightInches:56}).warnings.join(' '),/Refer to Home Office/);
  assert.equal(lookupBuildChart({company:names[1],heightInches:79}).values[1].value,'398-408 lb');
  assert.equal(lookupBuildChart({company:names[1],heightInches:54}).values[1].value,'182-188 lb');
});

test('missing, unsupported and non-integer heights return null instead of a truthy empty array', () => {
  for (const criteria of [undefined,null,{},[],{company:'Unknown',heightInches:74},{company:'__proto__',heightInches:74}]) assert.equal(lookupBuildChart(criteria),null);
  for (const heightInches of ['',null,undefined,false,[],[74],{},NaN,Infinity,74.5,'74x','0x4a',0,48,84]) assert.equal(lookupBuildChart({company:names[0],heightInches}),null);
  assert.equal(lookupBuildChart({company:names[2],heightInches:'83'}).values[1].value,'401 lb');
  assert.equal(lookupBuildChart({company:'mutual-of-omaha',heightInches:'74'}).heightInches,74);
});

test('returned chart values and options cannot mutate another lookup', () => {
  const catalogue = listBuildCharts();catalogue[0].heights[0].value=999;
  const chart = lookupBuildChart({company:names[0],heightInches:74});chart.values[0].value='wrong';chart.warnings.length=0;
  assert.equal(listBuildCharts()[0].heights[0].value,56);
  assert.equal(lookupBuildChart({company:names[0],heightInches:74}).values[0].value,'129 lb');
  assert.ok(lookupBuildChart({company:names[0],heightInches:74}).warnings.length);
});

test('real repository loads the chart module on demand; shared auth import remains canonical', async () => {
  const source = await readFile(new URL('../supabase-repository.js',import.meta.url),'utf8');
  assert.match(source,/async listBuildCharts\(\)/);
  assert.match(source,/await import\('\.\/build-charts\.js'\)/);
  assert.match(source,/return lookupBuildChart\(criteria\)/);
  assert.doesNotMatch(source,/async getBuildChart\([^)]*\)\s*\{\s*return \[\]/);
  assert.match(source,/import \{ supabase \} from '\.\/supabase-client\.js'/);
});
