// revisar.html → the page where that part of the old Revisar lives now (see review-redirect.js).
import { reviewRedirectTarget } from '../utils/review-redirect.js';

const target = reviewRedirectTarget(location.search, location.hash);
const link = document.querySelector('[data-review-redirect]');
if (link) link.href = target;
location.replace(target);
