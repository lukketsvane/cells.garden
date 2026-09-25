/** Publish the validated artwork transaction, not development code or forced refs. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(process.argv[2]||'.'),branch=process.argv[3];
if(!['dev','main'].includes(branch))throw new Error('Unsupported publishing branch');
const token=process.env.GITHUB_TOKEN;if(!token)throw new Error('GitHub Actions token is required');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const before=git('rev-parse','HEAD').trim();
if(git('diff','--cached','--name-only').trim())throw new Error('Publishing checkout already has staged changes');
const files=git('status','--porcelain=v1','-z','--untracked-files=all').split('\0').filter(Boolean).map(row=>row.slice(3));
const allowed=p=>(/^src\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.png$/.test(p)&&!p.includes('..'))||['figma/exports.json','figma/releases/dev.json','figma/releases/production.json','public/art-release.json'].includes(p);
const generated=new Set(['obsidian-plugin/main.js','obsidian-plugin/styles.css','obsidian-plugin/manifest.json']);
if(files.some(p=>!allowed(p)&&!generated.has(p)))throw new Error('Unexpected non-artwork changes in the publishing checkout');
const selected=files.filter(allowed);if(!selected.length){console.log('No approved changes');process.exit(0);}
for(const p of selected)if(!fs.existsSync(path.join(root,p))||fs.lstatSync(path.join(root,p)).isSymbolicLink())throw new Error('Deletion and symlink publication are not permitted');
git('add','--',...selected);
git('-c','user.name=tastefinger','-c','user.email=41840333+lukketsvane@users.noreply.github.com','commit','-m',branch==='dev'?'Publish approved Figma artwork to dev':'Promote verified Figma artwork to production');
const auth='AUTHORIZATION: basic '+Buffer.from('x-access-token:'+token).toString('base64');
const env={...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:auth};
const remote=execFileSync('git',['ls-remote','origin',`refs/heads/${branch}`],{cwd:root,env,encoding:'utf8'}).trim().split(/\s/)[0];
if(remote!==before)throw new Error('Remote branch moved during validation. Nothing was pushed; rerun on the latest branch.');
execFileSync('git',['push','origin',`HEAD:refs/heads/${branch}`],{cwd:root,env,stdio:'inherit'});
const commit=git('rev-parse','HEAD').trim();console.log(`Published Git commit ${commit}; deployment still requires verification.`);
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`commit=${commit}\n`);
