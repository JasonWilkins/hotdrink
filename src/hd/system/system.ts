/*********************************************************************
 * A ConstraintSystem's duties are
 *   1. Translate a model into a constraint graph
 *   2. Watch the variables to see when they change
 *   3. Run the planner to get a new solution graph
 *   4. Run the evaluator to produce new values
 */
module hd.config {
  export
  var defaultPlannerType: hd.plan.PlannerType = hd.plan.QuickPlanner;

  export
  var forwardEmergingSources = false;
}

module hd.system {

  import u = hd.utility;
  import r = hd.reactive;
  import m = hd.model;
  import g = hd.graph;
  import p = hd.plan;
  import e = hd.enable;
  import c = hd.config;

  // scheduling priority for responding to state changes
  export var SystemUpdatePriority = 1;

  /*==================================================================
   * Update strategies
   */
  export enum Update { None, Immediate, Scheduled }

  /*==================================================================
   * The constraint system
   */
  export class ConstraintSystem {

    // The constraint graph
    private cgraph: g.ConstraintGraph;
    getCGraph(): g.ReadOnlyConstraintGraph { return this.cgraph; }

    // The current solution graph
    private sgraph: g.SolutionGraph = null;
    getSGraph(): g.ReadOnlyConstraintGraph { return this.sgraph; }

    // Topological sorting of solution graph w.r.t. priority
    private topo: {vids: string[]; mids: string[]};

    // The planning algorithm
    private planner: p.Planner;
    getPlanner() {
      if (! this.planner) {
        this.planner = new c.defaultPlannerType( this.cgraph );
      }
      return this.planner;
    }

    // Lookup tables - convert ids back to objects
    variables:   u.Dictionary<m.Variable>   = {};
    methods:     u.Dictionary<m.Method>     = {};
    constraints: u.Dictionary<m.Constraint> = {};

    // Update strategies
    updateOnVariableChange = Update.Scheduled;
    updateOnModelChange = Update.Scheduled;

    // Flags for scheduled updates
    isUpdateScheduled = false;
    isUpdateNeeded = false;
    solved = new r.ObservableProperty( true );

    // Constraints added since the last plan
    private needEnforcing: u.StringSet = {};
    private needEvaluating: u.StringSet = {};

    // Touch dependencies
    private touchDeps: u.Dictionary<u.ArraySet<string>> = {};

    // Number of pending variables
    private pendingCount = 0;

    // Enablement
    enable: e.EnablementManager = new e.EnablementManager();
    outputVids: u.StringSet = {};

    /*----------------------------------------------------------------
     * Initialize members
     */
    constructor( plannerT: p.PlannerType = c.defaultPlannerType,
                 cgraphT: g.ConstraintGraphType = g.CachingConstraintGraph ) {
      this.cgraph = new cgraphT();
      if (plannerT) {
        this.planner = new plannerT( this.cgraph );
      }
      this.enable.egraph.addObserver( this, this.onNextEgraph, null, null );
    }

    /*----------------------------------------------------------------
     * Replace existing planner with new planner.
     */
    switchToNewPlanner( plannerT: p.PlannerType ) {
      var newPlanner = new plannerT( this.cgraph );
      if (this.planner) {
        var oldPlanner = this.planner;
        newPlanner.setOptionals( oldPlanner.getOptionals() );
      }
      this.planner = newPlanner;
      this.cgraph.constraints().reduce( u.stringSet.build, this.needEnforcing );
      this.modelUpdate();
    }

    /*----------------------------------------------------------------
     * Respond to model changes
     */

    //--------------------------------------------
    // Register modelcule
    addComponent( modelcule: m.Modelcule ) {
      if (modelcule instanceof m.ModelBuilder) {
        console.error( 'ModelBuilder passed to addComponent - did you forget to call end()?' );
        return;
      }
      // Add existing constraints
      m.Modelcule.constraints( modelcule ).forEach( this.addConstraint, this );
      // Watch for constraint changes
      m.Modelcule.changes( modelcule ).addObserver( this, this.onNextModelculeEvent, null, null );
    }

    //--------------------------------------------
    // De-register modelcule
    removeComponent( modelcule: m.Modelcule ) {
      // Remove existing constraints
      m.Modelcule.constraints( modelcule ).forEach( this.removeConstraint, this );
      // Stop watching for changes
      m.Modelcule.changes( modelcule ).removeObserver( this );
    }

    // --------------------------------------------
    // Dispatcher
    onNextModelculeEvent( event: m.ModelculeEvent ) {
      switch (event.type) {
      case m.ModelculeEventType.addConstraint:
        this.addConstraint( event.constraint );
        break;
      case m.ModelculeEventType.removeConstraint:
        this.removeConstraint( event.constraint );
        break;
      }
    }

    //--------------------------------------------
    // Add a new constraint
    addConstraint( cc: m.Constraint ) {
      if (! (cc.id in this.constraints)) {
        this.constraints[cc.id] = cc;

        cc.variables.forEach( this.addVariable, this );
        cc.methods.forEach( this.addMethod.bind( this, cc.id ) );
      }

      // Mark for update
      this.needEnforcing[cc.id] = true;
      this.modelUpdate();
    }

    //--------------------------------------------
    // Remove existing constraint
    removeConstraint( cc: m.Constraint ) {
      if (cc.id in this.constraints) {
        delete this.constraints[cc.id];

        cc.methods.forEach( this.removeMethod, this );
        cc.variables.forEach( this.removeVariable, this ); // no effect if variableused
                                                           // by another constraint

        this.sgraph.selectMethod( cc.id, null );
        this.enable.methodScheduled( cc.id, null );
      }
    }

    //--------------------------------------------
    // Add a new method
    private
    addMethod( cid: string, mm: m.Method ) {
      if (! (mm.id in this.methods)) {
        this.methods[mm.id] = mm;

        // Add to constraint graph
        this.cgraph.addMethod( mm.id,
                               cid,
                               mm.inputVars.map( u.getId ),
                               mm.outputVars.map( u.getId )
                             );
      }
    }

    //--------------------------------------------
    // Remove existing method
    private
    removeMethod( mm: m.Method ) {
      if (mm.id in this.methods) {
        delete this.methods[mm.id];

        // Remove from constraint graph
        this.cgraph.removeMethod( mm.id );
      }
    }

    /*----------------------------------------------------------------
     * Touch dependencies
     */

    makeConstraintOptional( cc: m.Constraint ) {
      this.getPlanner().setMinStrength( cc.id );
    }

    addTouchDependency( cc1: (m.Constraint|m.Variable),
                        cc2: (m.Constraint|m.Variable) ) {
      var cid1: string, cid2: string;
      if (cc1 instanceof m.Variable) {
        cid1 = g.stayConstraint( (<m.Variable>cc1).id );
      }
      else {
        cid1 = (<m.Constraint>cc1).id;
      }
      if (cc2 instanceof m.Variable) {
        cid2 = g.stayConstraint( (<m.Variable>cc2).id );
      }
      else {
        cid2 = (<m.Constraint>cc2).id;
      }

      if (this.touchDeps[cid1]) {
        u.arraySet.add( this.touchDeps[cid1], cid2 );
      }
      else {
        this.touchDeps[cid1] = [cid2];
      }
    }

    addTouchDependencies( cc1: (m.Constraint|m.Variable),
                          cc2s: (m.Constraint|m.Variable)[] ) {
      for (var i = 0, l = cc2s.length; i < l; ++i) {
        this.addTouchDependency( cc1, cc2s[i] );
      }
    }

    addTouchSet( ccs: (m.Constraint|m.Variable)[] ) {
      for (var i = 0, l = ccs.length; i < l; ++i) {
        for (var j = 0; j < l; ++j) {
          if (i != j) {
            this.addTouchDependency( ccs[i], ccs[j] );
          }
        }
      }
    }

    removeTouchDependency( cc1: (m.Constraint|m.Variable),
                           cc2: (m.Constraint|m.Variable) ) {
      var cid1: string, cid2: string;
      if (cc1 instanceof m.Variable) {
        cid1 = g.stayConstraint( (<m.Variable>cc1).id );
      }
      else {
        cid1 = (<m.Constraint>cc1).id;
      }
      if (cc2 instanceof m.Variable) {
        cid2 = g.stayConstraint( (<m.Variable>cc2).id );
      }
      else {
        cid2 = (<m.Constraint>cc2).id;
      }

      var deps = this.touchDeps[cid1];
      if (deps) {
        u.arraySet.remove( this.touchDeps[cid1], cid2 );
      }
    }

    removeTouchDependencies( cc1: (m.Constraint|m.Variable),
                             cc2s: (m.Constraint|m.Variable)[] ) {
      for (var i = 0, l = cc2s.length; i < l; ++i) {
        this.removeTouchDependency( cc1, cc2s[i] );
      }
    }

    removeTouchSet( ccs: (m.Constraint|m.Variable)[] ) {
      for (var i = 0, l = ccs.length; i < l; ++i) {
        for (var j = 0; j < l; ++j) {
          if (i != j) {
            this.removeTouchDependency( ccs[i], ccs[j] );
          }
        }
      }
    }

    /*----------------------------------------------------------------
     * Respond to variable changes
     */

    //--------------------------------------------
    // Add / register variable
    addVariable( vv: m.Variable ) {
      if (! (vv.id in this.variables)) {
        this.variables[vv.id] = vv;

        // Watch for variable events
        if (vv.pending.get()) {
          ++this.pendingCount;
        }
        if (vv.output.get()) {
          this.outputVids[vv.id] = true;
        }
        vv.changes.addObserver( this, this.onNextVariableChange, null, null );

        // Create stay constraint
        var stayMethodId = g.stayMethod( vv.id );
        var stayConstraintId = g.stayConstraint( vv.id );

        // Add variable+stay to existing graphs
        this.cgraph.addVariable( vv.id );
        this.cgraph.addMethod( stayMethodId, stayConstraintId, [], [vv.id] );

        // Set stay to optional
        if (! (<any>vv).staged && ! vv.pending.get() && vv.value.get() === undefined) {
          this.getPlanner().setMinStrength( stayConstraintId );
        }
        else {
          this.getPlanner().setMaxStrength( stayConstraintId );
        }

        // Mark stay constraint as changed
        this.needEnforcing[stayConstraintId] = true;
        // this.modelUpdate();
        // Technically we need an update to enforce the stay constraint
        // Practically speaking, though, that's not going to have any effect
        //   unless this variable's involved in another constraint, and
        //   we'll call modelUpdate when that one's added
      }
    }

    //--------------------------------------------
    // Remove / de-register variable
    removeVariable( vv: m.Variable ) {
      if ((vv.id in this.variables) &&
          this.cgraph.constraintsWhichUse( vv.id ).length == 0) {
        // Remove all references
        delete this.variables[vv.id];
        delete this.outputVids[vv.id];
        delete this.needEnforcing[stayConstraintId];
        delete this.needEvaluating[stayConstraintId];
        vv.changes.removeObserver( this );

        // Remove from graphs
        var stayConstraintId = g.stayConstraint( vv.id );
        this.cgraph.removeMethod( g.stayMethod( vv.id ) );
        this.planner.removeOptional( stayConstraintId );
        this.cgraph.removeVariable( vv.id );
      }
    }

    //--------------------------------------------
    // Dispatcher
    onNextVariableChange( event: m.VariableEvent ) {
      switch (event.type) {

      case m.VariableEventType.touched:
        this.variableTouched( event.vv );
        break;

      case m.VariableEventType.changed:
        this.variableChanged( event.vv );
        break;

      case m.VariableEventType.setOutput:
        this.variableIsOutput( event.vv, event.isOutput );

      case m.VariableEventType.pending:
        ++this.pendingCount;
        break;

      case m.VariableEventType.settled:
        if (this.pendingCount > 0) {
          --this.pendingCount;
          if (this.pendingCount == 0 && ! this.isUpdateNeeded) {
            this.solved.set( true );
          }
        }
        break;
      }
    }

    //--------------------------------------------
    // Touch variable and all touch dependencies
    private
    doPromotions( originalVid: string ) {
      var planner = this.getPlanner();
      var descending = function( cid1: string, cid2: string ) {
        return planner.compare( cid2, cid1 );
      };

      var promote: string[] = [];
      var i = 0;
      var visited: u.StringSet = {};
      promote.push( originalVid );
      visited[originalVid] = true;

      while (i < promote.length) {
        var vid = promote[i++];
        var deps = this.touchDeps[vid];
        if (deps) {
          (<string[]>deps).sort( descending );
          deps.forEach( function( dep: string ) {
            if (! visited[dep]) {
              promote.push( dep );
              visited[dep] = true;
            }
          } );
        }
      }

      for (--i; i >= 0; --i) {
        var cid = promote[i];
        planner.setMaxStrength( cid );
        if (! this.sgraph ||
            ! this.sgraph.selectedForConstraint( cid )) {
          this.needEnforcing[cid] = true;
        }
      }
    }

    //--------------------------------------------
    // Promote variable
    variableTouched( vv: m.Variable ) {
      var stayConstraintId = g.stayConstraint( vv.id );
      this.doPromotions( stayConstraintId );
      this.variableUpdate();
    }

    //--------------------------------------------
    // Promote variable and mark as changed
    variableChanged( vv: m.Variable ) {
      var stayConstraintId = g.stayConstraint( vv.id );
      this.doPromotions( stayConstraintId );
      this.needEvaluating[stayConstraintId] = true;
      this.variableUpdate();
    }

    //--------------------------------------------
    variableIsOutput( vv: m.Variable, isOutput: boolean ) {
      if (isOutput) {
        this.outputVids[vv.id] = true;
      }
      else {
        delete this.outputVids[vv.id];
      }
    }

    /*----------------------------------------------------------------
     */
    private
    modelUpdate() {
      this.isUpdateNeeded = true;
      this.solved.set( false );
      if (this.updateOnModelChange === Update.Immediate) {
        this.update();
      }
      else if (this.updateOnModelChange === Update.Scheduled) {
        this.scheduleUpdate();
      }
    }

    /*----------------------------------------------------------------
     */
    private
    variableUpdate() {
      this.isUpdateNeeded = true;
      this.solved.set( false );
      if (this.updateOnVariableChange === Update.Immediate) {
        this.update();
      }
      else if (this.updateOnVariableChange === Update.Scheduled) {
        this.scheduleUpdate();
      }
    }

    /*----------------------------------------------------------------
     */
    private
    scheduleUpdate() {
      if (! this.isUpdateScheduled) {
        this.isUpdateScheduled = true;
        u.schedule( SystemUpdatePriority, this.performScheduledUpdate, this );
      }
    }

    private
    performScheduledUpdate() {
      this.isUpdateScheduled = false;
      this.update();
    }

    /*----------------------------------------------------------------
     */
    update() {
      if (this.isUpdateNeeded) {
        this.isUpdateNeeded = false;
        this.plan();
        this.evaluate();
        if (this.pendingCount == 0) {
          this.solved.set( true );
        }
      }
    }

    /*----------------------------------------------------------------
     * Update solution graph & dependent info.
     */
    plan() {
      var cids = u.stringSet.members( this.needEnforcing );

      if (cids.length > 0) {

        // Run planner
        if (this.planner.plan( this.sgraph, cids )) {
          this.sgraph = this.planner.getSGraph();

          // Topological sort of all mids and vids
          this.topo = toposort( this.sgraph, this.planner );

          // Update stay strengths
          this.planner.setOptionals( u.reversemap( this.topo.vids, g.stayConstraint ) );

          // New constraints need to be evaluated
          cids.forEach( u.stringSet.add.bind( null, this.needEvaluating ) );

          // Reevaluate any emerging source variables
          if (config.forwardEmergingSources) {
            this.sgraph.variables().forEach( this.reevaluateIfEmergingSource, this );
          }

          // Update source statuses
          this.sgraph.variables().forEach( this.updateSourceStatus, this );
        }

        this.needEnforcing = {};
      }
    }


    // Helper - check for source variables that
    private
    reevaluateIfEmergingSource( vid: string ) {
      var vv = this.variables[vid];
      var stayConstraintId = g.stayConstraint( vid );

      // Evaluate if it's selected AND not previously a source
      //   AND not currently scheduled for evaluation
      if (this.sgraph.selectedForConstraint( stayConstraintId ) &&
          ! vv.source.get() && ! this.needEvaluating[stayConstraintId]) {

        vv.makePromise( vv.getForwardedPromise() );
        this.needEvaluating[stayConstraintId] = true;
      }
    }

    // Helper - set source property based on current solution graph
    private
    updateSourceStatus( vid: string ) {
      if (this.sgraph.selectedForConstraint( g.stayConstraint( vid ) )) {
        this.variables[vid].source.set( true );
      }
      else {
        this.variables[vid].source.set( false );
      }
    }

    /*----------------------------------------------------------------
     * Run any methods which need updating.
     */
    evaluate() {
      var mids = u.stringSet.members( this.needEvaluating )
            .map( function( cid: string ) {
              return this.sgraph.selectedForConstraint( cid );
            }, this )
            .filter( function( mid: string ) {
              return !! mid;
            } );

      if (mids.length > 0) {
        // Collect methods to be run
        var downstreamMids = new g.DigraphWalker( this.sgraph.graph )
              .nodesDownstreamSameType( mids )
              .filter( g.isNotStayMethod )
              .reduce( u.stringSet.build, <u.StringSet>{} );
        var scheduledMids = this.topo.mids
              .filter( function( mid: string ) { return downstreamMids[mid]; } );

        // Evaluate methods
        for (var i = 0, l = scheduledMids.length; i < l; ++i) {
          var mid = scheduledMids[i];
          var ar = this.methods[mid].activate( true );
          this.enable.methodScheduled( this.cgraph.constraintForMethod( mid ),
                                       mid,
                                       ar.inputs,
                                       ar.outputs
                                     );
        }

        // Commit all output promises
        var downstreamVids = new g.DigraphWalker( this.sgraph.graph )
              .nodesDownstreamOtherType( mids );
        for (var i = 0, l = downstreamVids.length; i < l; ++i) {
          var vid = downstreamVids[i];
          this.variables[vid].commitPromise();
        }

        this.needEvaluating = {};
      }
    }

    /*----------------------------------------------------------------
     */
    onNextEgraph( egraph: e.EnablementLabels ) {
      var outputVids = u.stringSet.members( this.outputVids );
      if (outputVids.length) {
        var labels = e.globalContributingCheck( this.sgraph,
                                                egraph,
                                                outputVids
                                              );
        for (var vid in this.variables) {
          var vv = this.variables[vid];
          if (labels[vid] === e.Label.Relevant) {
            vv.contributing.set( u.Fuzzy.Yes );
            vv.relevant.set( u.Fuzzy.Yes );
          }
          else if (labels[vid] === e.Label.AssumedRelevant) {
            vv.contributing.set( u.Fuzzy.Maybe );
            vv.relevant.set( u.Fuzzy.Maybe );
          }
          else {
            vv.contributing.set( u.Fuzzy.No );
            vv.relevant.set( e.relevancyCheck( this.cgraph,
                                               this.enable.egraph,
                                               this.outputVids,
                                               vid
                                             )
                           );
          }
        }
      }
    }

  }

}
