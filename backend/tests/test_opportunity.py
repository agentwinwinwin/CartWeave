from decimal import Decimal
from django.test import SimpleTestCase
from pydantic import ValidationError
from apps.skills.opportunity import propose

class OpportunityTests(SimpleTestCase):
    query={'fee_percent':'3','margin_percent':'30'}
    def row(self,vid,cost=11,days=10,inventory=50,supply='cj_stock'):
        return {'pid':'pid','vid':vid,'landed_cost':cost,'total_days':days,'inventory':inventory,'supply_type':supply}

    def test_scores_prices_and_ties_are_explainable_and_deterministic(self):
        a=self.row('a');b=self.row('b',cost=22,days=20,inventory=25)
        result=propose([b,a],self.query)
        self.assertEqual(result,propose([a,b],self.query))
        self.assertEqual(result['recommended_vid'],'a')
        self.assertEqual(Decimal(result['ranked'][0]['score']),100)
        self.assertEqual(result['ranked'][0]['suggested_price'],'16.42')
        self.assertEqual(Decimal(result['ranked'][1]['score']),50)
        self.assertIn('真实销量',result['unknowns'])

    def test_factory_supply_penalty_and_inventory_saturation(self):
        result=propose([self.row('factory',supply='factory'),self.row('stock',inventory=500)],self.query)
        self.assertEqual(result['recommended_vid'],'stock')
        self.assertEqual(Decimal(result['ranked'][0]['inventory_score']),100)
        self.assertEqual(Decimal(result['ranked'][1]['score']),90)

    def test_missing_facts_or_duplicate_id_cannot_be_guessed(self):
        with self.assertRaises(ValidationError):propose([self.row('a',cost=None)],self.query)
        with self.assertRaises(ValueError):propose([self.row('a'),self.row('a')],self.query)
        with self.assertRaises(ValueError):propose([],self.query)
        with self.assertRaises(ValueError):propose([self.row('a')],{'fee_percent':'90','margin_percent':'30'})
