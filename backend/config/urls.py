from django.urls import path
from apps.api import views as api
from apps.teststore import views as store
from apps.connections import views as connections
from apps.runtime import selection_views
from apps.connections import mapping_views
from apps.api.product_views import Products, ProductUnpublish
from apps.workflows.design_views import Designs, DesignFreeze, ReleaseDetail
from apps.workflows.release_views import Releases, ReleaseLifecycle
from apps.skills.market_views import MarketEvidenceView
from apps.runtime.schedule_views import Schedules, ScheduleDetail
from apps.finance.views import Earnings
from apps.commerce.views import BusinessList, BusinessSync
from apps.connections.intelligence_views import CJIntelligence, CJIntelligenceLogin, CJIntelligenceCollect, CJIntelligencePlans, CJIntelligencePlan, CJChromePairing, CJChromeBridge

urlpatterns = [
    path('api/v1/business/<str:kind>', BusinessList.as_view()),
    path('api/v1/stores/<uuid:pk>/sync/<str:kind>', BusinessSync.as_view()),
    path('api/v1/connections/cj/intelligence', CJIntelligence.as_view()),
    path('api/v1/connections/cj/intelligence/chrome-pairing', CJChromePairing.as_view()),
    path('api/v1/cj-browser/<str:action>', CJChromeBridge.as_view()),
    path('api/v1/connections/cj/intelligence/login', CJIntelligenceLogin.as_view()),
    path('api/v1/connections/cj/intelligence/collect', CJIntelligenceCollect.as_view()),
    path('api/v1/connections/cj/intelligence/plans', CJIntelligencePlans.as_view()),
    path('api/v1/connections/cj/intelligence/plans/<uuid:plan_id>', CJIntelligencePlan.as_view()),
    path('api/v1/earnings', Earnings.as_view()),
    path('api/v1/schedules', Schedules.as_view()),
    path('api/v1/schedules/<uuid:pk>', ScheduleDetail.as_view()),
    path('api/v1/market-evidence',MarketEvidenceView.as_view()),
    path('api/v1/workflow-designs', Designs.as_view()),
    path('api/v1/workflow-designs/<uuid:pk>/freeze', DesignFreeze.as_view()),
    path('api/v1/workflow-releases/<uuid:pk>', ReleaseDetail.as_view()),
    path('api/v1/workflow-releases', Releases.as_view()),
    path('api/v1/workflow-releases/<uuid:pk>/lifecycle', ReleaseLifecycle.as_view()),
    path('api/v1/products', Products.as_view()),
    path('api/v1/products/<uuid:pk>/unpublish', ProductUnpublish.as_view()),
    path('api/v1/model-connections', mapping_views.Models.as_view()),
    path('api/v1/model-connections/<uuid:pk>', mapping_views.ModelDetail.as_view()),
    path('api/v1/mappings', mapping_views.Mappings.as_view()),
    path('api/v1/mappings/<uuid:pk>', mapping_views.MappingDetail.as_view()),
    path('api/v1/selections', selection_views.Selections.as_view()),
    path('api/v1/selections/<uuid:pk>', selection_views.SelectionDetail.as_view()),
    path('api/v1/selections/<uuid:pk>/brief', selection_views.SelectionBrief.as_view()),
    path('api/v1/health', api.Health.as_view()),
    path('api/v1/integration-packages', api.IntegrationPackages.as_view()),
    path('api/v1/connections/cj', connections.CJConnection.as_view()),
    path('api/v1/connections/cj/verify', connections.CJVerify.as_view()),
    path('api/v1/connections/cj/categories', connections.CJCategories.as_view()),
    path('api/v1/connections/cj/search-preview', connections.CJSearchPreview.as_view()),
    path('api/v1/auth/session', api.Session.as_view()),
    path('api/v1/auth/login', api.Login.as_view()),
    path('api/v1/auth/logout', api.Logout.as_view()),
    path('api/v1/node-definitions', api.Definitions.as_view()),
    path('api/v1/members', api.Members.as_view()),
    path('api/v1/members/<int:pk>', api.MemberUpdate.as_view()),
    path('api/v1/audit', api.Audit.as_view()),
    path('api/v1/skills', api.Skills.as_view()),
    path('api/v1/skills/<uuid:pk>/review', api.SkillReview.as_view()),
    path('api/v1/stores', api.Stores.as_view()),
    path('api/v1/stores/<uuid:pk>/verify', api.StoreVerify.as_view()),
    path('api/v1/templates', api.Templates.as_view()),
    path('api/v1/workflows', api.Workflows.as_view()),
    path('api/v1/workflows/<uuid:pk>', api.WorkflowDetail.as_view()),
    path('api/v1/workflows/<uuid:pk>/validate', api.WorkflowValidate.as_view()),
    path('api/v1/workflows/<uuid:pk>/versions', api.Versions.as_view()),
    path('api/v1/runs', api.Runs.as_view()),
    path('api/v1/runs/<uuid:pk>', api.RunDetail.as_view()),
    path('api/v1/runs/<uuid:pk>/events', api.Events.as_view()),
    path('api/v1/runs/<uuid:pk>/revise', api.RunRevise.as_view()),
    path('api/v1/runs/<uuid:pk>/<str:action>', api.RunAction.as_view()),
    path('api/v1/approvals/<uuid:pk>/decisions', api.Decisions.as_view()),
    path('api/v1/listings/<uuid:pk>', api.ListingDetail.as_view()),
    path('api/test-store/v1/capabilities', store.Capabilities.as_view()),
    path('api/test-store/v1/contracts', store.Contracts.as_view()),
    path('api/test-store/v1/actions/<str:action>', store.Action.as_view()),
    path('api/test-store/v1/validate', store.Validate.as_view()),
    path('api/test-store/v1/products', store.Products.as_view()),
    path('api/test-store/v1/products/<uuid:pk>', store.ProductDetail.as_view()),
    path('api/test-store/v1/operations/<str:key>', store.Operation.as_view()),
    path('api/test-store/v1/catalog/<uuid:storefront_id>', store.PublicCatalog.as_view()),
    path('api/test-store/v1/catalog', store.PublicCatalog.as_view()),
]
