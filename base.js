/* global $ _ Backbone */

/* exported toQueryString */
function toQueryString(queryObject) {
	if (Array.isArray(queryObject)) {
		return queryObject
			.map(value => toQueryString(value))
			.join(',');
	}

	if (typeof queryObject === 'object' && queryObject !== null) {
		return Object.keys(queryObject)
			.filter(key => Object.prototype.hasOwnProperty.call(queryObject, key))
			.map(key => `${key}=${toQueryString(queryObject[key])}`)
			.join('&');
	}

	let prefix = '';
	switch (typeof queryObject) {
		case 'undefined':
			prefix = 'u';
			break;
		case 'boolean':
			prefix = 'b';
			break;
		case 'number':
			prefix = 'n';
			break;
		case 'function':
			prefix = 'f';
			break;
		case 'object':
			prefix = 'o';
			break;
		default:
			prefix = 's';
	}
	return encodeURIComponent(`${prefix}${String(queryObject)}`);
}

/* exported toQueryObject */
function toQueryObject(queryString) {
	if (typeof queryString !== 'string') {
		return queryString;
	}

	if (queryString.indexOf(',') !== -1) {
		return queryString
			.split(',')
			.map(str => toQueryObject(str));
	}

	if (queryString.indexOf('=') !== -1) {
		return queryString
			.split('&')
			.reduce((accumulator, currentValue, index, array) => {
				const [name, value] = currentValue.split('=');
				accumulator[name] = toQueryObject(value);
				return accumulator;
			}, {});
	}

	const prefix = queryString.charAt(0);
	let value = decodeURIComponent(queryString.slice(1));
	switch (prefix) {
		case 'u':
			value = undefined;
			break;
		case 'b':
			value = Boolean(value);
			break;
		case 'n':
			value = Number(value);
			break;
		case 'f':
			value = (new Function(`return ${value}`))();
			break;
		case 'o':
			value = null;
	}
	return value;
}

/* exported escapeODataValue */
function escapeODataValue(str) {
	return str
		.replace(/'/g, "''")
		.replace(/%/g, "%25")
		.replace(/\+/g, "%2B")
		.replace(/\//g, "%2F")
		.replace(/\?/g, "%3F")
		.replace(/#/g, "%23")
		.replace(/&/g, "%26")
		.replace(/\[/g, "%5B")
		.replace(/\]/g, "%5D")
		.replace(/\s/g, "%20");
}

/* exported stringToFunction */
function stringToFunction(str) {
	if (typeof str !== 'string') {
		return str;
	}

	if (str.indexOf('function(') === 0) {
		return Function(`return ${str}`)();
	} else if (typeof window[str] === 'function') {
		return window[str];
	}

	return null;
}

/* exported doAjax */
function doAjax(options) {
	return new Promise((resolve, reject) => {
		$.ajax(options)
			.then((data, textStatus, jqXHR) => {
				resolve(data);
			}, (jqXHR, textStatus, errorThrown) => {
				reject(errorThrown);
			});
	});
}

/* exported loadScripts */
function loadScripts(...urls) {
	const promises = [];

	urls.forEach(url => {
		if (document.querySelectorAll(`script[src="${url}"]`).length > 0) {
			return;
		}

		promises.push(new Promise((resolve, reject) => {
			var script = document.createElement('script');
			script.setAttribute('src', url);

			script.onload = () => { resolve(); };
			script.onreadystatechange = () => { resolve(); };
			script.onerror = () => { reject(); };

			document.getElementsByTagName('head')[0].appendChild(script);
		}));
	});

	return Promise.all(promises);
}

Backbone.sync = (backboneSync => ((method, model, options = {}) => {
	options.headers = options.headers || {};
	options.headers.Accept = options.headers.Accept || 'application/json; charset=utf-8';

	// LoginModel may or may not exist.
	if (!options.headers.Authorization && window.LoginModel && LoginModel.instance && LoginModel.instance
		&& LoginModel.instance !== model && !LoginModel.instance.isNew()) {

		options.headers.Authorization = `AuthSession ${LoginModel.instance.get(LoginModel.instance.idAttribute)}`;
	}

	if (method === 'create' || method === 'update' || method === 'patch') {
		options.contentType = options.contentType || 'application/json; charset=utf-8';

		if (!options.data) {
			let json = options.attrs || model.toJSON(options);
			delete json['@odata.context'];
			delete json['@odata.etag'];
			delete json['__CreatedOn'];
			delete json['__ModifiedOn'];
			delete json['__Owner'];

			const adjustSyncJson = options.adjustSyncJson || model.adjustSyncJson;
			if (adjustSyncJson) {
				json = adjustSyncJson(json);
			}

			options.data = JSON.stringify(json);
		}
	}

	// Return promise instead of differed.
	return new Promise((resolve, reject) => {
		backboneSync.call(this, method, model, options)
			.then((data, textStatus, jqXHR) => {
				resolve({ data, textStatus, jqXHR });
			}, (jqXHR, textStatus, errorThrown) => {
				reject({ jqXHR, textStatus, errorThrown })
			});
	});
}))(Backbone.sync);

/* exported BaseRouter */
const BaseRouter = Backbone.Router.extend({
	lastFragment: null,
	homeFragment: 'home',

	routeDefault() {

		// `this.lastFragment` can have a falsy value.
		if (this.lastFragment === null) {
			this.navigate(this.lastFragment);
		} else {
			const homeFragment = _.result(this, 'homeFragment');

			// `trigger` option is false by default. Needs to be true to trigger the route function.
			this.navigate(homeFragment, { trigger: true });
		}
	},

	route(route, name, callback) {
		let originalCallback;
		if (callback) {
			originalCallback = callback;
		} else if (typeof name === 'function') {
			originalCallback = name;
		} else if (typeof name === 'string') {
			originalCallback = this[name];
		}

		// Do not store the fragment that triggered `this.routeDefault`.
		if (originalCallback !== this.routeDefault) {
			const newCallback = function (...args) {
				this.lastFragment = Backbone.history.getFragment();
				return originalCallback.call(this, ...args);
			}

			if (callback) {
				callback = newCallback;
			} else if (typeof name === 'function') {
				name = newCallback;
			} else if (typeof name === 'string') {
				this[name] = newCallback;
			}
		}

		return Backbone.Router.prototype.route.call(this, route, name, callback);
	},

	cleanupFunction: null,

	execute(callback, args, name) {
		if (this.cleanupFunction) {
			const cleanupFunctionReturnValue = this.cleanupFunction.call(this, name);

			if (cleanupFunctionReturnValue === false) {
				return;
			}
		}

		// Promise is used to allow for an async callback.
		Promise.resolve()
			.then(() => {
				return callback.call(this, ...args);
			})
			.then(cleanupFunction => {
				this.cleanupFunction = cleanupFunction;
			})
			.then(() => {
				this.routeDefault();
			});
	}
});

/* exported BaseModel */
const BaseModel = Backbone.Model.extend(
	{
		url() {
			const baseUrl = _.result(this, 'urlRoot') || _.result(this.collection, 'url');

			if (this.isNew()) {
				return baseUrl;
			}

			return `${baseUrl.replace(/\/$/, '')}('${encodeURIComponent(this.get(this.idAttribute))}')`;
		},

		lastSyncData: BaseModel.lastSyncData,
		sync: BaseModel.sync,
		hasChangedSinceLastSync: BaseModel.hasChangedSinceLastSync,

		webStorage: BaseModel.webStorage,
		webStorageKey: BaseModel.webStorageKey,
		webStorageGet: BaseModel.webStorageGet,
		webStorageSet: BaseModel.webStorageSet,
		webStorageRemove: BaseModel.webStorageRemove
	},
	{
		lastSyncData: null,

		sync(method, model, options) {
			return this.sync(method, model, options)
				.then((returnValue) => {
					this.lastSyncData = JSON.stringify(this.toJSON())
					return returnValue;
				});
		},

		hasChangedSinceLastSync() {
			return JSON.stringify(this.toJSON()) === this.lastSyncData;
		},

		webStorage: localStorage,

		webStorageKey: null,

		webStorageGet(options) {
			const webStorage = _.result(this, 'webStorage');
			const webStorageKey = _.result(this, 'webStorageKey');

			if (webStorage && webStorageKey) {
				this.set(webStorage.getItem(webStorageKey, options));
			}
		},

		webStorageSet(options) {
			const webStorage = _.result(this, 'webStorage');
			const webStorageKey = _.result(this, 'webStorageKey');

			if (webStorage && webStorageKey) {
				webStorage.setItem(JSON.stringify(this.toJSON(options)));
			}
		},

		webStorageRemove(options) {
			const webStorage = _.result(this, 'webStorage');
			const webStorageKey = _.result(this, 'webStorageKey');

			if (webStorage && webStorageKey) {
				webStorage.removeItem(webStorageKey);
			}
		}
	}
);

/* exported BaseCollection */
const BaseCollection = Backbone.Collection.extend({
	model: BaseModel,

	fetch(options = {}) {
		if (options.query) {
			options.url = `${_.result(this, 'url')}?${options.query}`;
		}

		return Backbone.Collection.prototype.fetch.call(this, options);
	},

	parse(response, options) {
		if (response && Array.isArray(response.value)) {
			response = response.value;
		}

		return Backbone.Collection.prototype.parse.call(this, response, options);
	},

	lastSyncData: BaseModel.lastSyncData,
	sync: BaseModel.sync,
	hasChangedSinceLastSync: BaseModel.hasChangedSinceLastSync,

	webStorage: BaseModel.webStorage,
	webStorageKey: BaseModel.webStorageKey,
	webStorageGet: BaseModel.webStorageGet,
	webStorageSet: BaseModel.webStorageSet,
	webStorageRemove: BaseModel.webStorageRemove
});

/* exported BaseView */
const BaseView = Backbone.View.extend({
	render() {
		let linkButton = this.el.querySelector('a.btn:not([role="button"])');
		while (linkButton) {
			linkButton.setAttribute('role', 'button');
			linkButton.addEventListener('keydown', function (event) {
				if (event.which === 32) {
					event.preventDefault();
					event.target.click();
				}
			});
			linkButton = this.el.querySelector('a.btn:not([role="button"])');
		}

		return Promise.resolve();
	},

	appendTo(element) {
		element.appendChild(this.el);
		return this;
	},

	swapWith(newView) {
		const element = this.el;
		element.style.height = getComputedStyle(element).height;
		element.style.overflow = 'hidden';

		this.remove();

		return newView
			.appendTo(element)
			.render()
			.then(() => {
				element.style.removeProperty('overflow');
				element.style.removeProperty('height');

				return newView;
			});
	}
});

/* exported LoginModel */
const LoginModel = BaseModel.extend({
	idAttribute: 'sid',

	initialize(attributes, options) {
		this.on(`change:${this.idAttribute}`, () => {
			if (!this.isNew()) {
				this.webStorageSet();
			} else {
				this.webStorageRemove();
			}
		});

		this.webStorageGet();
		if (!this.isNew()) {
			this.fetch()
				.catch(() => {
					this.clear();
					this.webStorageRemove();
				});
		}

		Backbone.BaseModel.prototype.initialize.call(this, attributes, options);
	},

	parse(response, options) {
		delete response.pwd;
		return Backbone.BaseModel.prototype.parse.call(this, response, options);
	},

	save(attributes = {}, options = {}) {
		const { app = _.result(this, 'app'), user = this.get('user'), pwd = this.get('pwd') } = attributes;
		this.clear({ silent: true });
		return Backbone.BaseModel.prototype.save.call(this, { app, user, pwd }, options);
	},

	destroy(options = {}) {
		options.headers = options.headers || {};
		options.headers.Authorization = this.get('userID');
		return Backbone.BaseModel.prototype.destroy.call(this, options)
			.then(() => {
				this.clear()
			}, () => {
				this.clear()
			});
	},

	login(options) {
		return this.save(options);
	},

	logout() {
		return this.destroy();
	},

	isLoggedIn() {
		return !this.isNew();
	},

	authentication(options) {
		return new Promise((resolve, reject) => {
			if (!this.isLoggedIn()) {
				resolve(false);
			} else {
				this.fetch(options)
					.then(() => {
						resolve(this.isLoggedIn());
					}, (error) => {
						resolve(this.isLoggedIn());
					});
			}
		});
	}
});
