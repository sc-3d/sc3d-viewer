import * as flatbuffers from 'flatbuffers';
import * as flexbuffers from 'flatbuffers/js/flexbuffers.js';
import * as fla2  from "./fla2.js";

class GlbParser
{
    constructor(data)
    {
        this.data = data;
        this.glbHeaderInts = 3;
        this.glbChunkHeaderInts = 2;
        this.glbMagic = 0x46546C67;
        this.glbVersion = 2;
        this.jsonChunkType = 0x4E4F534A;
        this.fla2ChunkType = 0x32414C46;
        this.binaryChunkType = 0x004E4942;
    }

    extractGlbData()
    {
        const glbInfo = this.getCheckedGlbInfo();
        if (glbInfo === undefined)
        {
            return undefined;
        }

        let json = undefined;
        let buffers = [];
        const chunkInfos = this.getAllChunkInfos();
        for (let chunkInfo of chunkInfos)
        {
            if (chunkInfo.type == this.jsonChunkType && !json)
            {
                json = this.getJsonFromChunk(chunkInfo);
                console.log(json);
            }
            else if (chunkInfo.type == this.fla2ChunkType && !json)
            {
                json = this.getJsonFromFLA2Chunk(chunkInfo);
                console.log(json);
            }
            else if (chunkInfo.type == this.binaryChunkType)
            {
                buffers.push(this.getBufferFromChunk(chunkInfo));
            }
        }

        return { json: json, buffers: buffers };
    }

    getCheckedGlbInfo()
    {
        const header = new Uint32Array(this.data, 0, this.glbHeaderInts);
        const magic = header[0];
        const version = header[1];
        const length = header[2];

        if (!this.checkEquality(magic, this.glbMagic, "glb magic") ||
            !this.checkEquality(version, this.glbVersion, "glb header version") ||
            !this.checkEquality(length, this.data.byteLength, "glb byte length"))
        {
            return undefined;
        }

        return { "magic": magic, "version": version, "length": length };
    }

    getAllChunkInfos()
    {
        let infos = [];
        let chunkStart = this.glbHeaderInts * 4;
        while (chunkStart < this.data.byteLength)
        {
            const chunkInfo = this.getChunkInfo(chunkStart);
            infos.push(chunkInfo);
            chunkStart += chunkInfo.length + this.glbChunkHeaderInts * 4;
        }
        return infos;
    }

    getChunkInfo(headerStart)
    {
        const header = new Uint32Array(this.data, headerStart, this.glbChunkHeaderInts);
        const chunkStart = headerStart + this.glbChunkHeaderInts * 4;
        const chunkLength = header[0];
        const chunkType = header[1];
        return { "start": chunkStart, "length": chunkLength, "type": chunkType };
    }

    getJsonFromChunk(chunkInfo)
    {
        const chunkLength = chunkInfo.length;
        const jsonStart = (this.glbHeaderInts + this.glbChunkHeaderInts) * 4;
        const jsonSlice = new Uint8Array(this.data, jsonStart, chunkLength);
        const stringBuffer = new TextDecoder("utf-8").decode(jsonSlice);
        return JSON.parse(stringBuffer);
    }

    getJsonFromFLA2Chunk(chunkInfo)
    {
        const chunkLength = chunkInfo.length;
        const jsonStart = (this.glbHeaderInts + this.glbChunkHeaderInts) * 4;
        const jsonSlice = new Uint8Array(this.data, jsonStart, chunkLength);

        //console.log("jsonStart: %d, chunkLength: %d", jsonStart, chunkLength);

        var buf = new flatbuffers.ByteBuffer(jsonSlice);
        var fla2Root = fla2.FLA2Chunk.getRootAsFLA2Chunk(buf);
        
        var json = {
            extensionsUsed: [],
            extensionsRequired: [],
            asset: {}
        };

        //console.log(fla2Root.extensionsUsedLength())
        
        for (let i = 0; i < fla2Root.extensionsUsedLength(); i++) {
            json.extensionsUsed.push(fla2Root.extensionsUsed(i));            
        }
        for (let i = 0; i<fla2Root.extensionsRequiredLength(); i++) {
            json.extensionsRequired.push(fla2Root.extensionsRequired(i));
        }
        if (fla2Root.accessorsLength())
        {
            json.accessors = [];
            for (let i = 0; i < fla2Root.accessorsLength(); i++) {
                var accessor = {};
                var a = fla2Root.accessors(i);
                accessor.bufferView = a.bufferView();
                accessor.byteOffset = a.byteOffset();
                accessor.componentType = a.componentType() & 0xffff;
                if (a.normalized())
                    accessor.normalized = a.normalized();
                accessor.count = a.count();
                accessor.type = fla2.AccessorType[a.type()];
                
                if (a.maxLength()) {
                    accessor.max = [];    
                    for (let j = 0; j < a.maxLength(); j++)
                        accessor.max.push(a.max(j));
                }
                if (a.minLength()) {
                    accessor.min = [];
                    for (let j = 0; j < a.minLength(); j++)
                        accessor.min.push(a.min(j));
                }

                // TODO: sparse

                json.accessors.push(accessor);
            }
        }
        if (fla2Root.animationsLength()) {
            json.animations = [];
            for (let i = 0; i < fla2Root.animationsLength(); i++) {
                let animation = {};
                let a = fla2Root.animations(i);
                if (a.channelsLength()) {
                    animation.channels = [];
                    for (let j = 0; j < a.channelsLength(); j++) {
                        let channel = {};
                        let c = a.channels(j);
                        channel.sampler = c.sampler();
                        channel.target = {};
                        channel.target.node = c.target().node();
                        channel.target.path = fla2.AnimationChannelTargetPath[c.target().path()];
            
                        animation.channels.push(channel);
                    }
                }
                if (a.samplersLength()) {
                    animation.samplers = [];
                    for (let j = 0; j < a.samplersLength(); j++) {
                        let sampler = {};
                        let s = a.samplers(j);
                        sampler.input = s.input();
                        sampler.interpolation = fla2.AnimationSamplerInterpolationAlgorithm[s.interpolation()];
                        sampler.output = s.output();
            
                        animation.samplers.push(sampler);
                    }
                }            
                json.animations.push(animation);
            }
        }
        json.asset.generator = fla2Root.asset().generator();
        json.asset.version = fla2Root.asset().version();
        if (fla2Root.buffersLength()) {
            json.buffers = [];
            for (let i = 0; i < fla2Root.buffersLength(); i++) {
                var buffer = {};
                var b = fla2Root.buffers(i);
                buffer.byteLength = b.byteLength();
                if (b.uri()) {
                    buffer.uri = b.uri();
                }
                json.buffers.push(buffer);
            }
        }
        if (fla2Root.bufferViewsLength()) {
            json.bufferViews = [];
            for (let i = 0; i < fla2Root.bufferViewsLength(); i++) {
                let bufferView = {};
                let b = fla2Root.bufferViews(i);
                if (b.buffer() != -1)
                    bufferView.buffer = b.buffer();
                bufferView.byteOffset = b.byteOffset();
                bufferView.byteLength = b.byteLength();
                let byteStride = b.byteStride();
                if (byteStride >= 4 && byteStride <= 252)
                    bufferView.byteStride = b.byteStride();
                if (b.target())
                    bufferView.target = b.target();
                json.bufferViews.push(bufferView);
            }
        }
        // cameras
        // images
        if (fla2Root.imagesLength()) {
            json.images = [];
            for (let i = 0; i < fla2Root.imagesLength(); i++) {
                let image = {};
                let img = fla2Root.images(i);
                image.uri = img.uri();
                
                if (img.mimeType())
                    image.mimeType = img.mimeType();
                if (img.bufferView() != -1)
                    image.bufferView = img.bufferView();

                // test
                if (image.uri == "." && i == 0) {
                    //image.uri = "./apprenticebuilder_default_a.ktx";
                    image.uri = "ImageToStl.com_apprenticebuilder_default_a.png";
                    //image.mimeType = "image/ktx2";
                    image.mimeType = "image/png";
                }

                json.images.push(image);
            }
        }
        // materials
        if (fla2Root.materialsLength()) {
            json.materials = [];
            for (let i = 0; i < fla2Root.materialsLength(); i++) {
                let material = {};
                let m = fla2Root.materials(i);
                if (m.extensionsLength()) {
                    //std::string ext;
                    //m->extensions_flexbuffer_root().ToString(false, true, ext);
                    //const auto edoc = RapidJsonUtils::CreateDocumentFromString(ext);
                    //rapidjson::Value extension(rapidjson::kObjectType);
                    //extension.CopyFrom(edoc, allocator);
                    //material.AddMember("extensions", extension, allocator);
                    
                    let array = m.extensionsArray();                    
                    let arrayBuffer = array.buffer.slice(array.byteOffset, array.byteLength + array.byteOffset);                    
                    material.extensions = flexbuffers.toObject(arrayBuffer);
                    
                }
                json.materials.push(material);
            }
        }
        // meshes
        if (fla2Root.meshesLength()) {
            json.meshes = [];
            for (let i = 0; i < fla2Root.meshesLength(); i++) {
                let mesh = {};
                let m = fla2Root.meshes(i);
        
                mesh.primitives = [];
                for (let j = 0; j < m.primitivesLength(); j++) {
                    let primitive = {};
                    let p = m.primitives(j);
                    
                    let array = p.attributesArray();
                    console.log(array);                    
                    let arrayBuffer = array.buffer.slice(array.byteOffset, array.byteLength + array.byteOffset);
                    console.log(arrayBuffer);
                    primitive.attributes = flexbuffers.toObject(arrayBuffer);
                    console.log(primitive.attributes);

                    /*
                    p->attributes_flexbuffer_root().ToString(false, true, astr);
                    const auto adoc = RapidJsonUtils::CreateDocumentFromString(astr);
                    rapidjson::Value attributes(rapidjson::kObjectType);
                    attributes.CopyFrom(adoc, allocator);
                    primitive.AddMember("attributes", attributes, allocator);
                    */

                    if (p.indices() != -1)
                        primitive.indices = p.indices();
                    if (p.material() != -1)
                        primitive.material = p.material();
                    primitive.mode = p.mode();
        
                    if (p.targets()) {
                        // TODO
                    }
                    
                    mesh.primitives.push(primitive);
                }
        
                if (m.weightsLength()) {
                    mesh.weights = [];
                    for (let j = 0; j < m.weightsLength(); j++) {
                        mesh.weights.push(m.weights(j));
                    }
                }
                json.meshes.push(mesh);
            }
        }
        // nodes
        if (fla2Root.nodesLength()) {
            json.nodes = [];
            for (let i = 0; i < fla2Root.nodesLength(); i++) {
                let node = {};
                let n = fla2Root.nodes(i);
                if (n.camera() != -1)
                    node.camera = n.camera();
                if (n.childrenLength()) {
                    node.children = [];
                    for (let j = 0; j < n.childrenLength(); j++) {
                        node.children.push(n.children(j));
                    }
                }
                if (n.skin() != -1)
                    node.skin = n.skin();
        
                if (n.matrixLength()) {
                    node.matrix = [];
                    for (let j = 0; j < n.matrixLength(); j++) {
                        node.matrix.push(n.matrix(j));
                    }
                }
        
                if (n.mesh() != -1)
                    node.mesh = n.mesh();
        
                if (n.rotationLength()) {
                    node.rotation = [];
                    for (let j = 0; j < n.rotationLength(); j++) {
                        node.rotation.push(n.rotation(j));
                    }
                }
        
                if (n.scaleLength()) {
                    node.scale = [];
                    for (let j = 0; j < n.scaleLength(); j++) {
                        node.scale.push(n.scale(j));
                    }
                }
        
                if (n.translationLength()) {
                    node.translation = [];
                    for (let j = 0; j < n.translationLength(); j++) {
                        node.translation.push(n.translation(j));
                    }
                }
        
                if (n.weightsLength()) {
                    node.weights = [];
                    for (let j = 0; j < n.weightsLength(); j++) {
                        node.weights.push(n.weights(j));
                    }
                }
                if (n.name())
                    node.name = n.name();
        
                json.nodes.push(node);
            }
        }
        // samplers
        if (fla2Root.samplersLength()) {
            json.samplers = [];
            for (let i = 0; i < fla2Root.samplersLength(); i++) {
                let sampler = {};
                let s = fla2Root.samplers(i);
                sampler.magFilter = s.magFilter();
                sampler.minFilter = s.minFilter();
                if (s.wrapS() != 10497)
                    sampler.wrapS = s.wrapS();
                if (s.wrapT() != 10497)
                    sampler.wrapT = s.wrapT();
        
                json.samplers.push(sampler);
            }
        }       
        // scene
        if (fla2Root.scene() != -1)
            json.scene = fla2Root.scene();
        // scenes
        if (fla2Root.scenesLength()) {
            json.scenes = [];
            for (let i = 0; i < fla2Root.scenesLength(); i++) {
                let scene = {};
                let s = fla2Root.scenes(i);
                scene.nodes = [];
                for (let j = 0; j < s.nodesLength(); j++) {
                    scene.nodes.push(s.nodes(j));
                }
                json.scenes.push(scene);
            }
        }
        // skins
        if (fla2Root.skinsLength()) {
            json.skins = [];
            for (let i = 0; i < fla2Root.skinsLength(); i++) {
                let s = fla2Root.skins(i);
                let skin = {};
                skin.inverseBindMatrices = s.inverseBindMatrices();
                if (s.skeleton() >= 0) // glTFid.schema.json: "minimum": 0
                    skin.skeleton = s.skeleton();
                skin.joints = [];
                for (let j = 0; j < s.jointsLength(); j++) {
                    skin.joints.push(s.joints(j));
                }
                skin.name = s.name();
                json.skins.push(skin);
            }
        }
        // textures
        if (fla2Root.texturesLength()) {
            json.textures = [];
            for (let i = 0; i < fla2Root.texturesLength(); i++) {
                let texture = {};
                let t = fla2Root.textures(i);
                texture.sampler = t.sampler();
                texture.source = t.source();
        
                json.textures.push(texture);
            }
        }
        return json;
    }

    getBufferFromChunk(chunkInfo)
    {
        return this.data.slice(chunkInfo.start, chunkInfo.start + chunkInfo.length);
    }

    checkEquality(actual, expected, name)
    {
        if (actual == expected)
        {
            return true;
        }

        console.error("Found invalid/unsupported " + name + ", expected: " + expected + ", but was: " + actual);
        return false;
    }
}

export { GlbParser };
