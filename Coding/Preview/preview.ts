import {connectorFixture} from './connectorFixture';
import {diaryFixture} from './diaryFixture';
if(new URLSearchParams(location.search).has('diary'))(window as any).__diaryPreview=diaryFixture();
else (window as any).__connectorPreview=connectorFixture();