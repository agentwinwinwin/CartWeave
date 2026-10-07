import json
import uuid
from unittest.mock import patch
from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from apps.identity.models import Team, Membership
from apps.agents.models import OperationReport
from apps.agents.operations import retrieve
from tests.test_agents import AgentTests


class OperationsTests(TestCase):
    setUp=AgentTests.setUp
    transport=AgentTests.transport

    def create(self,kind='support',**values):
        return self.api.post('/api/v1/operation-reports/'+kind,{'request_key':str(uuid.uuid4()),
            **({'message':'标准配送需要多久？','sample_knowledge_confirmed':True} if kind=='support' else {}),**values},format='json')

    def test_seven_step_fixture_approval_persistence_and_no_remote_writes(self):
        result=self.create();self.assertEqual(result.status_code,201,result.data)
        report=result.data;p=report['payload']
        self.assertEqual(p['reply']['citations'],['Shipping'])
        self.assertFalse(p['usage']['model_called']);self.assertEqual(len(p['events']),4)
        confirm={'confirmed':True,'expected_revision':1}
        result=self.api.post('/api/v1/operation-report/'+report['id'],confirm,format='json')
        self.assertEqual(result.status_code,200,result.data);self.assertEqual(len(result.data['payload']['events']),7)
        self.assertEqual(result.data['payload']['remote_effects'],[])
        self.assertEqual(self.api.post('/api/v1/operation-report/'+report['id'],confirm,format='json').status_code,409)
        self.assertEqual(self.api.get('/api/v1/operation-reports/support').data['results'][0]['payload']['status'],'archived')
        from apps.runtime.models import WorkflowRun
        self.assertEqual(WorkflowRun.objects.count(),0)

    def test_no_policy_no_order_facts_or_no_consent_stop(self):
        for message in ['我要退款','cancel my order','量子纠缠']:
            result=self.create(message=message);self.assertEqual(result.status_code,201,result.data)
            self.assertEqual(result.data['payload']['status'],'handoff')
            self.assertEqual(self.api.post('/api/v1/operation-report/'+result.data['id'],{'confirmed':True,'expected_revision':1},format='json').status_code,422)
        self.assertEqual(self.create(sample_knowledge_confirmed=False).status_code,422)

    def test_real_pi_with_mock_provider_and_rag_citation_validation(self):
        reply={'schema_version':'GroundedSupportReply@1','reply':'测试政策：标准配送为 3–7 个工作日。',
            'citations':['Shipping'],'questions':[],'handoff_required':False}
        with patch('apps.connections.model_gateway.validate_endpoint',return_value='https://models.example/v1'), self.transport(json.dumps(reply)):
            response=self.create(mode='pi',connection_id=str(self.connection.id))
        self.assertEqual(response.status_code,201,response.data)
        self.assertEqual(response.data['payload']['usage']['harness']['version'],'1.0.4')
        self.assertEqual(response.data['payload']['usage']['harness']['purpose'],'customer_support_rag')
        reply['citations']=['Invented policy']
        with patch('apps.agents.operations.complete',return_value=(json.dumps(reply),{})):
            self.assertEqual(self.create(mode='pi',connection_id=str(self.connection.id)).status_code,422)

    def test_review_uses_no_fake_profit_and_idempotency_is_scoped(self):
        key=str(uuid.uuid4())
        report=self.create('reviews',request_key=key)
        self.assertEqual(report.status_code,201,report.data)
        self.assertIsNone(report.data['payload']['summary']['operating_profit'])
        self.assertFalse(report.data['payload']['adjustments_applied'])
        replay=self.create('reviews',request_key=key)
        self.assertEqual(replay.data['id'],report.data['id'])
        self.assertEqual(self.create('reviews',request_key=key,currency='EUR').status_code,409)
        self.assertEqual(self.create('reviews',mode='pi',connection_id=str(self.connection.id)).status_code,422)
        other=User.objects.create_user('operations-other');team=Team.objects.create(name='operations-other')
        Membership.objects.create(user=other,team=team,role='viewer');self.api.force_authenticate(user=other)
        self.assertEqual(self.api.get('/api/v1/operation-reports/reviews').data['count'],0)
        self.assertEqual(self.create('reviews').status_code,403)

    def test_retrieval_is_bounded_and_knowledge_has_pinned_sources(self):
        found=retrieve('shipping refund warranty price cancellation')
        self.assertLessEqual(len(found),3)
        for row in found:
            self.assertIn('058c8bc3101655ecd90d65d12f9b1534667f1917',row['source'])
            self.assertEqual(len(row['digest']),64)
