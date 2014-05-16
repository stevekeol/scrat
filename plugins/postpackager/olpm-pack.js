var UNIT_REG = /\{\{\{unit(?=\s)([^}]+)\}\}\}/g;
var UNIT_NAME_REG = /\sname\s*=\s*"([^"]+)"/;
var UNIT_DATA_REG = /\sdata\s*=\s*"([^"]+)"/;
var STYLES_PLACEHOLDER = '<!--[STYLES]-->';
var SCRIPTS_PLACEHOLDER = '<!--[SCRIPTS]-->';
var EJS = require('../../ejs/ejs.js');
var vm = require('vm');

var wrapError = function(err){
    var html = '<div style="color:red">';
    html += '<h2>' + (err.message || err) + '</h2>';
    if(err.stack){
        html += '<pre>' + err.stack + '</pre>';
    }
    html += '</div>';
    return html;
};

var getOlpmInfo = function(file, projCode, opt, ret){
    var name = file.filename;
    var prefix = file.isLayout ? 'layout' : 'unit';
    var description = '';
    var olpmJson = file.dirname + '/olpm.json';
    if(fis.util.exists(olpmJson)){
        var olpmInfo = fis.util.readJSON(olpmJson);
        name = olpmInfo.name || name;
        description = olpmInfo.description;
    } else {
        fis.log.warning('missing olpm.json file of file [' + file.subpath + ']');
    }
    var info = {
        file  : file.release,
        name  : name,
        description : description || '',
        code  : projCode + '_' + prefix + '_' + file.filename
    };
    if(file.isUnit){
        var data = ret.src[file.subdirname + '/data.js'];
        if(data){
            info.data = data.release;
        }
    }
    var thumb = ret.src[file.subdirname + '/thumb.png'];
    if(thumb){
        info.thumb = opt.md5 ? thumb.getHashRelease() : thumb.release;
    }
    return info;
};

module.exports = function(ret, conf, settings, opt){
    var olpm = fis.config.get('olpm');
    if(olpm.code && olpm.name){
        var map = {
            name : olpm.name,
            code : olpm.code,
            description : olpm.description || '',
            files : {
                layouts : [],
                units : [],
                assets : []
            }
        };
        var isInline = olpm.pack === fis.olpm.PACK_TYPE_INLINE;
        var codes = {};
        fis.util.map(ret.src, function(subpath, file){
            if(file.isLayout){
                //todo
                var res = {
                    js  : [],
                    css : []
                };
                var loaded = {};
                var content = file.getContent();
                var collect = function(file){
                    if(loaded[file.subpath]) return;
                    loaded[file.subpath] = true;
                    file.requires.forEach(function(id){
                        var f = ret.ids[id];
                        if(f){
                            collect(f);
                        } else {
                            fis.log.warning('undefined id[' + id + ']');
                        }
                    });
                    if(file.isJsLike){
                        res.js.push(file);
                    } else if(file.isCssLike){
                        res.css.push(file);
                    }
                };
                content = content.replace(UNIT_REG, function(m){
                    var name, data;
                    m = m.replace(UNIT_NAME_REG, function(mm, $$1){
                        name = $$1;
                        return '';
                    });
                    m = m.replace(UNIT_DATA_REG, function(mm, $$1){
                        data = $$1;
                        return '';
                    });
                    if(name){
                        var dir = '/components/' + name + '/';
                        var filename = dir + name;
                        var tpl = ret.src[filename + '.ejs'];
                        if(tpl){
                            if(!opt.pack){
                                var ejs = new EJS({text:tpl.getContent()});
                                //todo
                                var dataFileName = ( data || 'data' ).replace(/\.js$/, '') + '.js';
                                var dataFile = fis.file(tpl.dirname + '/' + dataFileName);
                                if(dataFile){
                                    var sandbox = { module : {} };
                                    var code = 'var exports=module.exports={};' + dataFile.getContent();
                                    try {
                                        vm.runInNewContext(code, sandbox);
                                        m = ejs.render(sandbox.module.exports);
                                    } catch(e){
                                        m = wrapError('data error [' + e.message + ']');
                                    }
                                } else {
                                    m = wrapError('data file [' + (data || 'data') + '.js] not found');
                                }
                            }
                            collect(tpl);
                        } else {
                            m = wrapError('unit [' + name + '] is not found');
                        }
                    }
                    return m;
                });
                var eof = opt.optimize ? '' : '\n';
                var styles = '', scripts = '';
                if(opt.pack){
                    //pack css
                    if(res.css.length){
                        var css = '';
                        res.css.forEach(function(file){
                            if(isInline){
                                var attr = opt.optimize ? '' : ' data-path="' + file.subpath + '"';
                                css += [ '<style' + attr + '>', file.getContent(), '</style>', '' ].join(eof);
                            } else {
                                var comment = opt.optimize ? '' : '/*-[' + file.subpath + ']-*/';
                                css += [ comment, file.getContent(), '' ].join(eof);
                            }
                        });
                        if(isInline){
                            styles = css;
                        } else {
                            var cssfile = fis.file(fis.project.getProjectPath('pkg/' + file.filename + '.css'));
                            cssfile.setContent(css);
                            cssfile.compiled = true;
                            ret.pkg[cssfile.subpath] = cssfile;
                            styles = '<link rel="stylesheet" href="' + cssfile.getUrl(opt.hash, opt.domain) + '"/>' + eof;
                            map.files.assets.push({
                                file : opt.md5 ? cssfile.getHashRelease() : cssfile.release,
                                type : cssfile.rExt.replace(/^\./, '')
                            });
                        }
                    }

                    if(res.js.length){
                        //pack js
                        var js = '';
                        res.js.forEach(function(file){
                            if(isInline){
                                var attr = opt.optimize ? '' : ' data-path="' + file.subpath + '"';
                                js += [ '<script' + attr + '>', file.getContent(), '</script>', '' ].join(eof);
                            } else {
                                var comment = opt.optimize ? '' : '/*-[' + file.subpath + ']-*/';
                                js += [ comment, file.getContent(), '' ].join(eof);
                            }
                        });
                        if(isInline){
                            scripts = js;
                        } else {
                            var jsfile = fis.file(fis.project.getProjectPath('pkg/' + file.filename + '.js'));
                            jsfile.setContent(js);
                            jsfile.compiled = true;
                            ret.pkg[jsfile.subpath] = jsfile;
                            scripts = '<script src="' + jsfile.getUrl(opt.hash, opt.domain) + '"></script>' + eof;
                            map.files.assets.push({
                                file : opt.md5 ? jsfile.getHashRelease() : jsfile.release,
                                type : jsfile.rExt.replace(/^\./, '')
                            });
                        }
                    }
                } else {
                    res.css.forEach(function(file){
                        styles += '<link rel="stylesheet" href="' + file.getUrl(opt.hash, opt.domain) + '"/>' + eof;
                    });
                    res.js.forEach(function(file){
                        scripts += '<script src="' + file.getUrl(opt.hash, opt.domain) + '"></script>' + eof;
                    });
                }
                if(content.indexOf(STYLES_PLACEHOLDER) > 0){
                    content = content.replace(STYLES_PLACEHOLDER, styles);
                } else {
                    content = content.replace(/(?=<\/head>)/i, styles);
                }
                if(content.indexOf(SCRIPTS_PLACEHOLDER) > 0){
                    content = content.replace(SCRIPTS_PLACEHOLDER, scripts);
                } else {
                    content = content.replace(/(?=<\/body>)/i, scripts);
                }
                file.setContent(content);
                map.files.layouts.push(getOlpmInfo(file, olpm.code, opt, ret));
            } else if(file.isUnit){
                //todo
                map.files.units.push(getOlpmInfo(file, olpm.code, opt, ret));
            } else if(file.isMod && opt.pack) {
                //todo
                delete ret.src[file.subpath];
                file.release = false;
            } else if(file.isAssets){
                map.files.assets.push({
                    file : opt.md5 ? file.getHashRelease() : file.release,
                    type : file.rExt.replace(/^\./, '')
                });
            }
        });
        var file = fis.file(fis.project.getProjectPath('release.json'));
        file.setContent(JSON.stringify(map, null, 4));
        file.compiled = true;
        ret.pkg[file.subpath] = file;
    } else if(!olpm.code) {
        fis.log.error('missing project code, use `fis.config.set("olpm.code", value);` in fis-conf.js');
    } else if(!olpm.name){
        fis.log.error('missing project name, use `fis.config.set("olpm.name", value);` in fis-conf.js');
    }
};