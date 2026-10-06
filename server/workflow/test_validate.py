import copy
import unittest
from validate import CATALOG, validate

def make(template_id='shopify.launch', profile='shopify_cj'):
    template = next(t for t in CATALOG['templates'] if t['id'] == template_id)
    nodes = copy.deepcopy(template['nodes'])
    return dict(schemaVersion='1', id=template_id, revision=1, profileId=profile, templateId=template_id,
                title=template['title'], nodes=nodes,
                edges=forward(nodes) + copy.deepcopy(template['relations']))

def forward(nodes):
    return [dict(id=f"{a['id']}:{b['id']}", source=a['id'], target=b['id'], kind='forward') for a,b in zip(nodes,nodes[1:])]

def codes(draft):
    return {error['code'] for error in validate(draft)['errors']}

class ValidationTests(unittest.TestCase):
    def test_all_templates_profiles(self):
        for template in CATALOG['templates']:
            for profile in template['profiles']:
                with self.subTest(template=template['id'], profile=profile):
                    result = validate(make(template['id'], profile))
                    self.assertTrue(result['valid'], result)

    def test_delete_approval_and_bypass(self):
        draft=make('shopify.fulfillment')
        draft['nodes']=[n for n in draft['nodes'] if n['id']!='purchase']
        draft['edges']=forward(draft['nodes'])
        self.assertIn('REQUIRED_STEP', codes(draft))

    def test_cross_platform(self):
        draft=make('amazon.fba_orders','amazon_fba')
        draft['nodes'].insert(2,dict(id='purchase',definitionId='shopify.fulfillment.purchase',title='采购',skillId=None,config={}))
        draft['edges']=forward(draft['nodes'])
        self.assertIn('PLATFORM_CAPABILITY',codes(draft))

    def test_skill_cannot_bypass_contract(self):
        draft=make()
        next(n for n in draft['nodes'] if n['id']=='research')['skillId']='campaign-creative'
        self.assertIn('SKILL_CONTRACT',codes(draft))

    def test_client_cannot_forge_ports(self):
        draft=make()
        draft['nodes'][0]['output']='ApprovedAmazonShipment'
        self.assertIn('PYDANTIC_STRUCTURE',codes(draft))

    def test_extensions_preserve_context(self):
        for definition,skill in [('extension.review',None),('extension.rule',None),('extension.ai','context-review')]:
            draft=make()
            draft['nodes'].insert(2,dict(id='extra',definitionId=definition,title='扩展',skillId=skill,config={}))
            draft['edges']=forward(draft['nodes'])+draft['edges'][-2:]
            self.assertTrue(validate(draft)['valid'],validate(draft))

    def test_fixed_handler_cannot_become_skill(self):
        draft=make();draft['nodes'][0]['skillId']='context-review'
        self.assertIn('FIXED_HANDLER',codes(draft))

    def test_unreachable_gate(self):
        draft=make()
        draft['edges']=[e for e in draft['edges'] if e['source']!='approve' and e['target']!='approve']
        draft['edges'].append(dict(id='bypass',source='research',target='content',kind='forward'))
        self.assertIn('GRAPH_SHAPE',codes(draft))

    def test_forbidden_replay(self):
        draft=make('shopify.fulfillment')
        draft['edges'].append(dict(id='repeat',source='dispatch',target='purchase',kind='feedback'))
        self.assertIn('UNSAFE_FEEDBACK',codes(draft))

    def test_unknown_version_and_parameters(self):
        draft=make();draft['nodes'][0]['definitionVersion']='2';draft['nodes'][0]['config']['timeout']=-1
        self.assertIn('PYDANTIC_STRUCTURE',codes(draft))

    def test_collaboration_cannot_execute_payment(self):
        draft=make('shopify.fulfillment')
        draft['edges'].append(dict(id='joint',source='quote',target='purchase',kind='collaboration'))
        self.assertIn('UNSAFE_COLLABORATION',codes(draft))

if __name__=='__main__': unittest.main()
